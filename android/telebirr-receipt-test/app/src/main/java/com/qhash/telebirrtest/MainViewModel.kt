package com.qhash.telebirrtest

import android.util.Log
import androidx.compose.runtime.mutableStateListOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

data class PendingDeposit(
    val depositId: String,
    val transactionReference: String,
    val receiptUrl: String,
    val expectedReceiverName: String?,
    val createdAt: String
)

data class LogEntry(
    val timestamp: String,
    val message: String,
    val isError: Boolean = false
)

class MainViewModel : ViewModel() {

    companion object {
        private const val TAG = "VerifierVM"
        private const val AUTO_POLL_INTERVAL_MS = 120_000L
        private const val AUTO_VERIFY_DELAY_MS = 2_500L
        private const val MAX_LOG_ENTRIES = 300
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    val backendUrl = MutableStateFlow("https://clever-pika-a9180e.netlify.app")
    val apiKey = MutableStateFlow("")

    private val _fetchingDeposits = MutableStateFlow(false)
    val fetchingDeposits = _fetchingDeposits.asStateFlow()

    private val _pendingDeposits = MutableStateFlow<List<PendingDeposit>>(emptyList())
    val pendingDeposits = _pendingDeposits.asStateFlow()

    private val _verifyingDepositId = MutableStateFlow<String?>(null)
    val verifyingDepositId = _verifyingDepositId.asStateFlow()

    private val _autoMode = MutableStateFlow(false)
    val autoMode = _autoMode.asStateFlow()

    private var autoPollingJob: Job? = null

    private var autoCycleCount = 0
    private var consecutiveNetworkErrors = 0

    val log = mutableStateListOf<LogEntry>()

    private val dateFormat = SimpleDateFormat("HH:mm:ss", Locale.US)

    private fun isNetworkError(e: Throwable): Boolean = when (e) {
        is UnknownHostException,
        is SocketTimeoutException,
        is ConnectException,
        is IOException -> true
        else -> false
    }

    private fun addLog(message: String, isError: Boolean = false) {
        val entry = LogEntry(
            timestamp = dateFormat.format(Date()),
            message = message,
            isError = isError
        )
        log.add(0, entry)
        while (log.size > MAX_LOG_ENTRIES) {
            log.removeAt(log.size - 1)
        }
        Log.d(TAG, "${if (isError) "ERR" else "LOG"}: $message")
    }

    fun fetchPendingDeposits() {
        viewModelScope.launch {
            _fetchingDeposits.value = true
            addLog("Fetching pending TeleBirr deposits...")
            try {
                val deposits = suspendFetchPending()
                _pendingDeposits.value = deposits
                addLog("Found ${deposits.size} pending deposit(s)")
            } catch (e: Exception) {
                addLog("Failed to fetch deposits: ${e.message}", isError = true)
                _pendingDeposits.value = emptyList()
            }
            _fetchingDeposits.value = false
        }
    }

    private suspend fun suspendFetchPending(): List<PendingDeposit> {
        val baseUrl = backendUrl.value.trimEnd('/')
        val key = apiKey.value.trim()

        if (key.isEmpty()) {
            throw Exception("API key is required")
        }

        return withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$baseUrl/api/verifier/pending-telebirr")
                .header("X-Verifier-Api-Key", key)
                .header("Accept", "application/json")
                .get()
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string()

            if (!response.isSuccessful) {
                throw Exception("HTTP ${response.code}: ${body?.take(300) ?: "no body"}")
            }

            val json = JSONObject(body ?: "{}")
            val depositsArray = json.optJSONArray("deposits") ?: JSONArray()

            val list = mutableListOf<PendingDeposit>()
            for (i in 0 until depositsArray.length()) {
                val d = depositsArray.getJSONObject(i)
                list.add(
                    PendingDeposit(
                        depositId = d.getString("deposit_id"),
                        transactionReference = d.getString("transaction_reference"),
                        receiptUrl = d.getString("receipt_url"),
                        expectedReceiverName = if (d.isNull("expected_receiver_name")) null
                            else d.getString("expected_receiver_name"),
                        createdAt = d.optString("created_at", "")
                    )
                )
            }
            list
        }
    }

    fun verifyDeposit(deposit: PendingDeposit) {
        viewModelScope.launch {
            _verifyingDepositId.value = deposit.depositId
            try {
                suspendVerifyDeposit(deposit)
            } catch (e: Exception) {
                addLog("Verification error: ${e.message}", isError = true)
            }
            _verifyingDepositId.value = null
        }
    }

    private suspend fun suspendVerifyDeposit(deposit: PendingDeposit) {
        addLog("--- Verifying deposit ${deposit.depositId} ---")
        addLog("Ref: ${deposit.transactionReference}")
        addLog("Fetching receipt: ${deposit.receiptUrl}")

        val (fetchStatus, fetchError, parsed) = withContext(Dispatchers.IO) {
            try {
                val receiptRequest = Request.Builder()
                    .url(deposit.receiptUrl)
                    .header("User-Agent", "QHash-TeleBirr-Verifier-Android/1.0")
                    .header("Accept", "text/html,application/xhtml+xml,*/*")
                    .build()

                val response = client.newCall(receiptRequest).execute()
                val body = response.body?.string()

                if (response.isSuccessful && body != null) {
                    val p = ReceiptParser.parse(body)
                    Triple("success", null as String?, p)
                } else {
                    Triple("fetch_failed", "HTTP ${response.code}" as String?, null as ParsedReceipt?)
                }
            } catch (e: Exception) {
                Triple("fetch_failed", e.message as String?, null as ParsedReceipt?)
            }
        }

        if (fetchStatus == "success" && parsed != null) {
            addLog("Receipt parsed — txId: ${parsed.transactionId ?: "null"}, amount: ${parsed.amount ?: "null"}, receiver: ${parsed.receiverName ?: "null"}, paymentDate: ${parsed.paymentDate ?: "null"}")
        } else {
            addLog("Receipt fetch failed: $fetchError", isError = true)
        }

        val payload = JSONObject().apply {
            put("deposit_id", deposit.depositId)
            put("transaction_reference", deposit.transactionReference)
            put("receipt_fetch_status", fetchStatus)

            if (fetchStatus == "success" && parsed != null) {
                put("extracted_transaction_id", parsed.transactionId ?: JSONObject.NULL)
                val amountNum = parsed.amount?.toDoubleOrNull()
                if (amountNum != null) put("extracted_amount", amountNum)
                else put("extracted_amount", JSONObject.NULL)
                put("extracted_receiver_name", parsed.receiverName ?: JSONObject.NULL)
                val status = parsed.status?.takeIf { it.isNotBlank() } ?: "Completed"
                put("extracted_status", status)
                put("extracted_payment_date", parsed.paymentDate ?: JSONObject.NULL)
                put("verifier_note", "Verified by Android receipt verifier")
            } else {
                put("extracted_transaction_id", JSONObject.NULL)
                put("extracted_amount", JSONObject.NULL)
                put("extracted_receiver_name", JSONObject.NULL)
                put("extracted_status", "Unavailable")
                put("extracted_payment_date", JSONObject.NULL)
                put("verifier_note", "Android verifier could not fetch receipt")
            }
        }

        addLog("Submitting result to backend...")

        val (statusCode, responseBody) = withContext(Dispatchers.IO) {
            val baseUrl = backendUrl.value.trimEnd('/')
            val submitRequest = Request.Builder()
                .url("$baseUrl/api/verifier/submit-telebirr-result")
                .header("X-Verifier-Api-Key", apiKey.value.trim())
                .header("Content-Type", "application/json")
                .post(payload.toString().toRequestBody("application/json".toMediaType()))
                .build()

            val response = client.newCall(submitRequest).execute()
            val body = response.body?.string()
            Pair(response.code, body)
        }

        if (statusCode in 200..299) {
            addLog("Response (HTTP $statusCode): ${responseBody ?: "empty body"}")

            val respJson = try { JSONObject(responseBody ?: "{}") } catch (_: Exception) { null }
            val action = respJson?.optString("action", "") ?: ""

            when (action) {
                "approved" -> {
                    addLog("Approved")
                    _pendingDeposits.value = _pendingDeposits.value.filter {
                        it.depositId != deposit.depositId
                    }
                }
                "manual_review" -> {
                    val failures = respJson?.optJSONArray("failures")
                    addLog("Manual review", isError = true)
                    if (failures != null && failures.length() > 0) {
                        for (i in 0 until failures.length()) {
                            addLog("  failure: ${failures.getString(i)}", isError = true)
                        }
                    }
                }
                "rejected" -> {
                    addLog("Rejected", isError = true)
                    val reasons = respJson?.optJSONArray("reasons")
                    if (reasons != null && reasons.length() > 0) {
                        for (i in 0 until reasons.length()) {
                            addLog("  reason: ${reasons.getString(i)}", isError = true)
                        }
                    }
                    _pendingDeposits.value = _pendingDeposits.value.filter {
                        it.depositId != deposit.depositId
                    }
                }
                else -> {
                    addLog("Unknown action: \"$action\"", isError = true)
                }
            }
        } else {
            addLog("Submit failed (HTTP $statusCode): ${responseBody?.take(300)}", isError = true)
        }
    }

    fun clearLog() {
        log.clear()
    }

    fun exportLog(): String {
        return log.joinToString("\n") { entry ->
            "[${entry.timestamp}] ${if (entry.isError) "ERR" else "OK "} ${entry.message}"
        }
    }

    fun toggleAutoMode() {
        if (_autoMode.value) {
            _autoMode.value = false
            stopAutoPolling()
        } else {
            if (backendUrl.value.isBlank()) {
                addLog("Auto Mode requires a backend URL", isError = true)
                return
            }
            if (apiKey.value.isBlank()) {
                addLog("Auto Mode requires an API key", isError = true)
                return
            }
            _autoMode.value = true
            startAutoPolling()
        }
    }

    private fun startAutoPolling() {
        autoPollingJob?.cancel()
        autoPollingJob = viewModelScope.launch {
            addLog("Auto Mode started")
            autoCycleCount = 0
            consecutiveNetworkErrors = 0
            try {
                while (isActive && _autoMode.value) {
                    if (backendUrl.value.isBlank() || apiKey.value.isBlank()) {
                        addLog("Auto Mode stopped — missing configuration", isError = true)
                        _autoMode.value = false
                        break
                    }

                    if (_fetchingDeposits.value) {
                        addLog("Auto fetch skipped — manual fetch in progress")
                        delay(AUTO_POLL_INTERVAL_MS)
                        continue
                    }

                    autoCycleCount++
                    addLog("Auto fetch cycle #$autoCycleCount started")
                    try {
                        val deposits = suspendFetchPending()
                        consecutiveNetworkErrors = 0
                        _pendingDeposits.value = deposits
                        addLog("Auto found ${deposits.size} pending deposit(s)")

                        if (deposits.isNotEmpty()) {
                            for (deposit in deposits) {
                                if (!isActive || !_autoMode.value) break

                                if (_verifyingDepositId.value != null) {
                                    addLog("Auto verify skipped — manual verification in progress")
                                    break
                                }

                                _verifyingDepositId.value = deposit.depositId
                                try {
                                    addLog("Auto verifying deposit ${deposit.depositId}")
                                    suspendVerifyDeposit(deposit)
                                } catch (e: Exception) {
                                    addLog("Auto verify error: ${e.message}", isError = true)
                                } finally {
                                    _verifyingDepositId.value = null
                                }

                                if (isActive && _autoMode.value) {
                                    delay(AUTO_VERIFY_DELAY_MS)
                                }
                            }
                        }
                    } catch (e: Exception) {
                        if (isNetworkError(e)) {
                            consecutiveNetworkErrors++
                            val suffix = if (consecutiveNetworkErrors > 1) {
                                " ($consecutiveNetworkErrors consecutive)"
                            } else {
                                ""
                            }
                            addLog("Network error — will retry next cycle$suffix", isError = true)
                        } else {
                            addLog("Auto fetch error: ${e.message}", isError = true)
                        }
                    }

                    delay(AUTO_POLL_INTERVAL_MS)
                }
            } finally {
                addLog("Auto Mode stopped")
            }
        }
    }

    private fun stopAutoPolling() {
        autoPollingJob?.cancel()
        autoPollingJob = null
    }

    override fun onCleared() {
        super.onCleared()
        stopAutoPolling()
    }
}
