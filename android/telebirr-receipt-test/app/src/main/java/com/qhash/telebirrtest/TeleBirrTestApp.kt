package com.qhash.telebirrtest

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel

private val DarkBg = Color(0xFF0A0A0A)
private val SurfaceBg = Color(0xFF111111)
private val NeonGreen = Color(0xFF00FF41)
private val BorderDim = Color(0xFF1A1A1A)
private val BorderNeon = Color(0x2600FF41)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeleBirrTestApp(vm: MainViewModel = viewModel()) {
    val fetchingDeposits by vm.fetchingDeposits.collectAsState()
    val pendingDeposits by vm.pendingDeposits.collectAsState()
    val verifyingDepositId by vm.verifyingDepositId.collectAsState()
    val backendUrl by vm.backendUrl.collectAsState()
    val apiKey by vm.apiKey.collectAsState()
    val autoMode by vm.autoMode.collectAsState()
    val context = LocalContext.current

    MaterialTheme(
        colorScheme = darkColorScheme(
            background = DarkBg,
            surface = SurfaceBg,
            primary = NeonGreen,
            onBackground = Color.White,
            onSurface = Color.White
        )
    ) {
        Scaffold(
            containerColor = DarkBg,
            topBar = {
                TopAppBar(
                    title = {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text(
                                "QHash TeleBirr Verifier",
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold
                            )
                            if (autoMode) {
                                Text(
                                    "AUTO",
                                    fontSize = 9.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Color.Black,
                                    modifier = Modifier
                                        .background(NeonGreen, RoundedCornerShape(4.dp))
                                        .padding(horizontal = 6.dp, vertical = 2.dp)
                                )
                            }
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = SurfaceBg,
                        titleContentColor = Color.White
                    )
                )
            }
        ) { padding ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // Configuration Card
                NeonCard {
                    Column(modifier = Modifier.padding(16.dp)) {
                        SectionTitle("Configuration")
                        Spacer(Modifier.height(8.dp))

                        FieldLabel("Backend URL")
                        OutlinedTextField(
                            value = backendUrl,
                            onValueChange = { vm.backendUrl.value = it },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            textStyle = LocalTextStyle.current.copy(
                                fontSize = 12.sp,
                                fontFamily = FontFamily.Monospace
                            ),
                            colors = neonTextFieldColors()
                        )

                        Spacer(Modifier.height(8.dp))

                        FieldLabel("API Key (X-Verifier-Api-Key)")
                        OutlinedTextField(
                            value = apiKey,
                            onValueChange = { vm.apiKey.value = it },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            placeholder = {
                                Text("Enter your verifier API key", fontSize = 12.sp)
                            },
                            textStyle = LocalTextStyle.current.copy(
                                fontSize = 12.sp,
                                fontFamily = FontFamily.Monospace
                            ),
                            colors = neonTextFieldColors()
                        )

                        Spacer(Modifier.height(12.dp))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text(
                                    "Auto Mode",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = if (autoMode) NeonGreen else Color.White
                                )
                                Text(
                                    "Polls every 2 minutes while app is open",
                                    fontSize = 9.sp,
                                    color = Color(0xFF666666)
                                )
                            }
                            Switch(
                                checked = autoMode,
                                onCheckedChange = { vm.toggleAutoMode() },
                                enabled = apiKey.isNotBlank(),
                                colors = SwitchDefaults.colors(
                                    checkedThumbColor = Color.Black,
                                    checkedTrackColor = NeonGreen,
                                    uncheckedThumbColor = Color.Gray,
                                    uncheckedTrackColor = Color(0xFF333333)
                                )
                            )
                        }
                    }
                }

                // Fetch Pending Button
                Button(
                    onClick = { vm.fetchPendingDeposits() },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = apiKey.isNotBlank() && !fetchingDeposits,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = NeonGreen,
                        contentColor = Color.Black
                    ),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    if (fetchingDeposits) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp,
                            color = Color.Black
                        )
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(
                        if (fetchingDeposits) "Fetching..." else "Fetch Pending TeleBirr Deposits",
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp
                    )
                }

                // Pending Deposits List
                if (pendingDeposits.isNotEmpty()) {
                    NeonCard {
                        Column(modifier = Modifier.padding(16.dp)) {
                            SectionTitle("Pending Deposits (${pendingDeposits.size})")
                            Spacer(Modifier.height(8.dp))

                            pendingDeposits.forEachIndexed { index, deposit ->
                                if (index > 0) Spacer(Modifier.height(8.dp))
                                DepositCard(
                                    deposit = deposit,
                                    isVerifying = verifyingDepositId == deposit.depositId,
                                    anyVerifying = verifyingDepositId != null,
                                    onVerify = { vm.verifyDeposit(deposit) }
                                )
                            }
                        }
                    }
                } else if (!fetchingDeposits && vm.log.isNotEmpty()) {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = SurfaceBg),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text(
                            "No pending deposits",
                            fontSize = 11.sp,
                            color = Color(0xFF555555),
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center
                        )
                    }
                }

                // Activity Log
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = SurfaceBg),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                "Activity Log (${vm.log.size})",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Color(0xFFCCCCCC)
                            )
                            if (vm.log.isNotEmpty()) {
                                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    Text(
                                        "Export",
                                        fontSize = 10.sp,
                                        color = Color.Gray,
                                        modifier = Modifier.clickable {
                                            val text = vm.exportLog()
                                            val intent = Intent(Intent.ACTION_SEND).apply {
                                                type = "text/plain"
                                                putExtra(Intent.EXTRA_TEXT, text)
                                            }
                                            context.startActivity(
                                                Intent.createChooser(intent, "Export Log")
                                            )
                                        }
                                    )
                                    Text(
                                        "Copy",
                                        fontSize = 10.sp,
                                        color = Color.Gray,
                                        modifier = Modifier.clickable {
                                            copyToClipboard(context, vm.exportLog())
                                        }
                                    )
                                    Text(
                                        "Clear",
                                        fontSize = 10.sp,
                                        color = Color(0xFFEF4444),
                                        modifier = Modifier.clickable { vm.clearLog() }
                                    )
                                }
                            }
                        }

                        Spacer(Modifier.height(8.dp))

                        if (vm.log.isEmpty()) {
                            Text(
                                "No activity yet",
                                fontSize = 10.sp,
                                color = Color(0xFF444444),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 16.dp),
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center
                            )
                        } else {
                            Column(
                                modifier = Modifier.heightIn(max = 400.dp),
                                verticalArrangement = Arrangement.spacedBy(2.dp)
                            ) {
                                vm.log.forEach { entry ->
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .background(DarkBg, RoundedCornerShape(6.dp))
                                            .border(1.dp, BorderDim, RoundedCornerShape(6.dp))
                                            .padding(horizontal = 10.dp, vertical = 6.dp),
                                        verticalAlignment = Alignment.Top,
                                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                                    ) {
                                        Box(
                                            modifier = Modifier
                                                .padding(top = 4.dp)
                                                .size(6.dp)
                                                .clip(CircleShape)
                                                .background(
                                                    if (entry.isError) Color(0xFFEF4444)
                                                    else Color(0xFF22C55E)
                                                )
                                        )
                                        Text(
                                            entry.timestamp,
                                            fontSize = 9.sp,
                                            color = Color(0xFF555555),
                                            modifier = Modifier.padding(top = 1.dp)
                                        )
                                        Text(
                                            entry.message,
                                            fontSize = 10.sp,
                                            color = if (entry.isError) Color(0xFFEF4444)
                                                else Color(0xFF999999),
                                            modifier = Modifier.weight(1f)
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                Spacer(Modifier.height(32.dp))
            }
        }
    }
}

@Composable
private fun DepositCard(
    deposit: PendingDeposit,
    isVerifying: Boolean,
    anyVerifying: Boolean,
    onVerify: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(DarkBg, RoundedCornerShape(8.dp))
            .border(1.dp, BorderDim, RoundedCornerShape(8.dp))
            .padding(12.dp)
    ) {
        DepositField("Deposit ID", deposit.depositId)
        DepositField("Tx Reference", deposit.transactionReference)
        DepositField("Receipt URL", deposit.receiptUrl)
        DepositField("Expected Receiver", deposit.expectedReceiverName ?: "—")
        DepositField("Created", deposit.createdAt)

        Spacer(Modifier.height(8.dp))

        Button(
            onClick = onVerify,
            modifier = Modifier.fillMaxWidth(),
            enabled = !anyVerifying,
            colors = ButtonDefaults.buttonColors(
                containerColor = if (isVerifying) Color(0xFF333333) else Color(0xFF1A3A1A),
                contentColor = NeonGreen
            ),
            shape = RoundedCornerShape(6.dp)
        ) {
            if (isVerifying) {
                CircularProgressIndicator(
                    modifier = Modifier.size(14.dp),
                    strokeWidth = 2.dp,
                    color = NeonGreen
                )
                Spacer(Modifier.width(8.dp))
                Text("Verifying...", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            } else {
                Text("Verify This Deposit", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun DepositField(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            label,
            fontSize = 10.sp,
            color = Color.Gray,
            modifier = Modifier.width(100.dp)
        )
        Text(
            value,
            fontSize = 10.sp,
            fontFamily = FontFamily.Monospace,
            color = Color(0xFFDDDDDD),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
    }
}

@Composable
private fun NeonCard(content: @Composable () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = SurfaceBg),
        shape = RoundedCornerShape(12.dp),
        border = CardDefaults.outlinedCardBorder().copy(
            width = 1.dp,
            brush = SolidColor(BorderNeon)
        )
    ) {
        content()
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        color = NeonGreen
    )
}

@Composable
private fun FieldLabel(text: String) {
    Text(
        text,
        fontSize = 10.sp,
        color = Color.Gray,
        modifier = Modifier.padding(bottom = 4.dp)
    )
}

@Composable
private fun neonTextFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = NeonGreen,
    unfocusedBorderColor = BorderDim,
    cursorColor = NeonGreen
)

private fun copyToClipboard(context: Context, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("Verifier Log", text))
    Toast.makeText(context, "Copied to clipboard", Toast.LENGTH_SHORT).show()
}
