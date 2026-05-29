import { useEffect } from "react";
import { useAuthStore } from "@/store/authStore.js";
import { useWalletStore } from "@/store/walletStore.js";

export function useWalletSync() {
  const user = useAuthStore((s) => s.user);
  const startPolling = useWalletStore((s) => s.startPolling);
  const stopPolling = useWalletStore((s) => s.stopPolling);
  const reset = useWalletStore((s) => s.reset);

  useEffect(() => {
    if (user?.id) {
      startPolling(user.id);
    } else {
      reset();
    }
    return () => stopPolling();
  }, [user?.id, startPolling, stopPolling, reset]);
}
