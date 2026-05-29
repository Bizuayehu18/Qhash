package com.qhash.telebirrtest

import android.util.Log
import org.jsoup.Jsoup

data class ParsedReceipt(
    val transactionId: String?,
    val amount: String?,
    val receiverName: String?,
    val status: String?,
    val paymentDate: String?
)

object ReceiptParser {

    private const val TAG = "ReceiptParser"

    fun parse(html: String): ParsedReceipt {
        Log.d(TAG, "Starting TeleBirr receipt parsing")

        val doc = Jsoup.parse(html)
        val rows = doc.select("tr")
        Log.d(TAG, "Found ${rows.size} <tr> rows")

        var transactionId: String? = null
        var amount: String? = null
        var receiverName: String? = null
        var paymentDate: String? = null

        val allRowCells = mutableListOf<List<String>>()
        for (row in rows) {
            val cells = row.select("> td, > th").map { normalizeText(it.text()) }
            allRowCells.add(cells)
            Log.d(TAG, "ROW[${allRowCells.size - 1}] cells=$cells")
        }

        for (i in allRowCells.indices) {
            val cells = allRowCells[i]
            if (cells.size < 2) continue

            val firstCellLower = cells[0].lowercase()

            if (receiverName == null && firstCellLower.contains("credited party name")) {
                val value = cells[1]
                if (value.isNotEmpty()) {
                    receiverName = value
                    Log.d(TAG, "receiverName=[$value] from row $i")
                }
            }

            val cellLowers = cells.map { it.lowercase() }
            val txColIndex = cellLowers.indexOfFirst { it.contains("invoice no") }
            val amountColIndex = cellLowers.indexOfFirst { it.contains("settled amount") }
            val dateColIndex = cellLowers.indexOfFirst { it.contains("payment date") }

            if (txColIndex >= 0 && amountColIndex >= 0 && i + 1 < allRowCells.size) {
                val valueRow = allRowCells[i + 1]
                Log.d(TAG, "Header row at $i, txCol=$txColIndex, amountCol=$amountColIndex, dateCol=$dateColIndex, valueRow=$valueRow")

                if (txColIndex < valueRow.size) {
                    val v = valueRow[txColIndex]
                    if (v.isNotEmpty() && !v.lowercase().contains("invoice")) {
                        transactionId = v
                        Log.d(TAG, "transactionId=[$v]")
                    }
                }
                if (amountColIndex < valueRow.size) {
                    val v = valueRow[amountColIndex]
                    if (v.isNotEmpty() && !v.lowercase().contains("settled")) {
                        amount = cleanAmount(v)
                        Log.d(TAG, "amount=[$amount] from raw=[$v]")
                    }
                }
                if (dateColIndex >= 0 && dateColIndex < valueRow.size) {
                    val v = valueRow[dateColIndex]
                    if (v.isNotEmpty() && !v.lowercase().contains("payment date")) {
                        paymentDate = v
                        Log.d(TAG, "paymentDate=[$v]")
                    }
                }
            }
        }

        Log.d(TAG, "FINAL transactionId=$transactionId")
        Log.d(TAG, "FINAL amount=$amount")
        Log.d(TAG, "FINAL receiverName=$receiverName")
        Log.d(TAG, "FINAL paymentDate=$paymentDate")

        return ParsedReceipt(
            transactionId = transactionId,
            amount = amount,
            receiverName = receiverName,
            status = null,
            paymentDate = paymentDate
        )
    }

    private fun normalizeText(text: String): String {
        return text.trim().replace(Regex("[\\s\\t\\n\\r]+"), " ")
    }

    private fun cleanAmount(raw: String): String? {
        val cleaned = raw
            .replace(",", "")
            .replace(Regex("(?i)\\s*birr\\s*"), "")
            .replace(Regex("(?i)\\s*etb\\s*"), "")
            .trim()
        val match = Regex("(\\d+(?:\\.\\d+)?)").find(cleaned)
        return match?.groupValues?.get(1)
    }
}
