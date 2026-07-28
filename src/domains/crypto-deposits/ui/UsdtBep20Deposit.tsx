import { Coins } from "lucide-react";
import { useUsdtBep20Deposit } from "./useUsdtBep20Deposit.js";
import { UsdtBep20DepositView } from "./UsdtBep20DepositView.js";

export {
  copyButtonAccessibleName,
  copyUsdtDepositAddress,
  IDLE_COPY_FEEDBACK,
  INITIAL_NOWPAYMENTS_DEPOSIT_UI_STATE,
  nowpaymentsDepositUiReducer,
  nowpaymentsDepositUiVisibility,
} from "./usdt-bep20-deposit-state.js";
export type {
  CopyFeedback,
  NowpaymentsDepositUiAction,
  NowpaymentsDepositUiState,
} from "./usdt-bep20-deposit-state.js";

export function UsdtBep20Deposit({
  accessToken,
  onBack,
}: {
  accessToken: string | null;
  onBack: () => void;
}) {
  const {
    handleCopy,
    handleGenerate,
    loadOverview,
    ...viewState
  } = useUsdtBep20Deposit(accessToken);
  return (
    <UsdtBep20DepositView
      {...viewState}
      onBack={onBack}
      onCopy={handleCopy}
      onGenerate={handleGenerate}
      onRetry={loadOverview}
    />
  );
}

export function CryptoDepositMethodIcon() {
  return <Coins size={15} />;
}
