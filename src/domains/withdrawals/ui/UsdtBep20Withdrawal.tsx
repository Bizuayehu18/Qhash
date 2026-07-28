import { UsdtBep20WithdrawalView } from "./UsdtBep20WithdrawalView.js";
import { useUsdtBep20Withdrawal } from "./useUsdtBep20Withdrawal.js";

export function UsdtBep20Withdrawal({
  accessToken,
  userId,
  onBack,
}: {
  accessToken: string | null;
  userId: string | null;
  onBack: () => void;
}) {
  const {
    handleMax,
    handleSubmit,
    loadOverview,
    setDestination,
    setFundPassword,
    setGrossAmount,
    setHistoryExpanded,
    ...viewState
  } = useUsdtBep20Withdrawal({ accessToken, userId });

  return (
    <UsdtBep20WithdrawalView
      {...viewState}
      onBack={onBack}
      onDestinationChange={setDestination}
      onFundPasswordChange={setFundPassword}
      onGrossAmountChange={setGrossAmount}
      onHistoryExpandedChange={setHistoryExpanded}
      onMax={handleMax}
      onRetry={() => void loadOverview()}
      onSubmit={() => void handleSubmit()}
    />
  );
}
