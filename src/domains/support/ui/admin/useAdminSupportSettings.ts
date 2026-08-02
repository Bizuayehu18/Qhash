import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getSafeErrorMessage } from "@/lib/errors.js";
import {
  adminSupportSettingsGlobalSaveFlight,
  createAdminSupportSettingsAuthIdentity,
  createAdminSupportSettingsScopedValue,
  createLatestAdminSupportSettingsRequestGuard,
  isSameAdminSupportSettingsAuthIdentity,
  readAdminSupportSettingsScopedValue,
  type AdminSupportSettingsAuthIdentity,
  type AdminSupportSettingsScopedValue,
} from "../../application/admin-support-settings-auth-lifecycle.js";
import {
  loadAdminSupportSettings,
  saveAdminSupportTelegramUsername,
  type AdminSupportSettings,
} from "../../application/admin-support-settings-browser-service.js";

type AdminSupportSettingsSnapshot = Readonly<{
  identity: AdminSupportSettingsAuthIdentity;
  settings: AdminSupportSettings;
}>;

type LoadFlight = Readonly<{
  identity: AdminSupportSettingsAuthIdentity;
  promise: Promise<boolean>;
  token: symbol;
}>;

export function useAdminSupportSettings(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
) {
  const identity = useMemo(
    () => createAdminSupportSettingsAuthIdentity(userId, accessToken),
    [accessToken, userId],
  );
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const [snapshot, setSnapshot] =
    useState<AdminSupportSettingsSnapshot | null>(null);
  const [draft, setDraft] =
    useState<AdminSupportSettingsScopedValue<string> | null>(null);
  const draftRef = useRef(draft);
  const [loadingState, setLoadingState] =
    useState<AdminSupportSettingsScopedValue<boolean> | null>(null);
  const [savingState, setSavingState] =
    useState<AdminSupportSettingsScopedValue<boolean> | null>(null);

  const mountedRef = useRef(false);
  const loadGuardRef = useRef(createLatestAdminSupportSettingsRequestGuard());
  const saveGuardRef = useRef(createLatestAdminSupportSettingsRequestGuard());
  const activeLoadRef = useRef<LoadFlight | null>(null);

  const setTelegramUsername = useCallback((value: string) => {
    const currentIdentity = identityRef.current;
    if (!currentIdentity) return;

    const nextDraft = createAdminSupportSettingsScopedValue(
      currentIdentity,
      value,
    );
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }, []);

  const load = useCallback((): Promise<boolean> => {
    const requestIdentity = identityRef.current;
    if (!requestIdentity) return Promise.resolve(false);

    const activeLoad = activeLoadRef.current;
    if (
      activeLoad
      && isSameAdminSupportSettingsAuthIdentity(
        activeLoad.identity,
        requestIdentity,
      )
    ) {
      return activeLoad.promise;
    }

    setLoadingState(
      createAdminSupportSettingsScopedValue(requestIdentity, true),
    );
    const request = loadGuardRef.current.begin(requestIdentity);
    const flightToken = Symbol("admin-support-settings-load-flight");
    const promise = (async () => {
      try {
        await adminSupportSettingsGlobalSaveFlight.whenIdle();
        if (!mountedRef.current || !request.isCurrent(identityRef.current)) {
          return false;
        }

        const settings = await loadAdminSupportSettings();
        if (!mountedRef.current || !request.isCurrent(identityRef.current)) {
          return false;
        }

        setSnapshot({ identity: requestIdentity, settings });
        const nextDraft = createAdminSupportSettingsScopedValue(
          requestIdentity,
          settings.telegramUsername ?? "",
        );
        draftRef.current = nextDraft;
        setDraft(nextDraft);
        return true;
      } catch (error) {
        if (!mountedRef.current || !request.isCurrent(identityRef.current)) {
          return false;
        }

        toast.error(getSafeErrorMessage(error, "SUPPORT").message);
        return false;
      } finally {
        if (request.isCurrent(identityRef.current)) {
          setLoadingState(
            createAdminSupportSettingsScopedValue(requestIdentity, false),
          );
        }
        if (activeLoadRef.current?.token === flightToken) {
          activeLoadRef.current = null;
        }
      }
    })();

    activeLoadRef.current = {
      identity: requestIdentity,
      promise,
      token: flightToken,
    };
    return promise;
  }, []);

  const save = useCallback((): Promise<boolean> => {
    const requestIdentity = identityRef.current;
    if (!requestIdentity) {
      toast.error("Session expired. Please sign in again.");
      return Promise.resolve(false);
    }

    const currentDraft = draftRef.current;
    const submittedUsername =
      readAdminSupportSettingsScopedValue(currentDraft, requestIdentity) ?? "";
    setSavingState(
      createAdminSupportSettingsScopedValue(requestIdentity, true),
    );

    return adminSupportSettingsGlobalSaveFlight.run(requestIdentity, async () => {
      const request = saveGuardRef.current.begin(requestIdentity);
      loadGuardRef.current.invalidate();
      activeLoadRef.current = null;
      setLoadingState(
        createAdminSupportSettingsScopedValue(requestIdentity, false),
      );

      try {
        const settings = await saveAdminSupportTelegramUsername(
          requestIdentity.accessToken,
          submittedUsername,
        );
        if (!mountedRef.current || !request.isCurrent(identityRef.current)) {
          return false;
        }

        setSnapshot({ identity: requestIdentity, settings });
        if (
          readAdminSupportSettingsScopedValue(
            draftRef.current,
            requestIdentity,
          ) === submittedUsername
        ) {
          const nextDraft = createAdminSupportSettingsScopedValue(
            requestIdentity,
            settings.telegramUsername ?? "",
          );
          draftRef.current = nextDraft;
          setDraft(nextDraft);
        }
        toast.success("Support Telegram username updated.");
        return true;
      } catch (error) {
        if (!mountedRef.current || !request.isCurrent(identityRef.current)) {
          return false;
        }

        toast.error(getSafeErrorMessage(error, "SUPPORT").message);
        return false;
      } finally {
        if (request.isCurrent(identityRef.current)) {
          setSavingState(
            createAdminSupportSettingsScopedValue(requestIdentity, false),
          );
        }
      }
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadGuardRef.current.invalidate();
      saveGuardRef.current.invalidate();
      activeLoadRef.current = null;
    };
  }, []);

  useEffect(() => {
    loadGuardRef.current.invalidate();
    saveGuardRef.current.invalidate();
    activeLoadRef.current = null;
    setSnapshot(null);
    const nextDraft = identity
      ? createAdminSupportSettingsScopedValue(identity, "")
      : null;
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setSavingState(
      identity
        ? createAdminSupportSettingsScopedValue(identity, false)
        : null,
    );

    if (identity) {
      setLoadingState(
        createAdminSupportSettingsScopedValue(identity, true),
      );
      void load();
    } else {
      setLoadingState(null);
    }

    return () => {
      loadGuardRef.current.invalidate();
      saveGuardRef.current.invalidate();
      activeLoadRef.current = null;
    };
  }, [identity, load]);

  const visibleSnapshot = snapshot
    && isSameAdminSupportSettingsAuthIdentity(snapshot.identity, identity)
    ? snapshot
    : null;
  const loading = identity
    ? readAdminSupportSettingsScopedValue(loadingState, identity) ?? true
    : false;
  const saving =
    readAdminSupportSettingsScopedValue(savingState, identity) ?? false;
  const telegramUsername =
    readAdminSupportSettingsScopedValue(draft, identity) ?? "";

  return {
    loading,
    save,
    saving,
    settings: visibleSnapshot?.settings ?? null,
    setTelegramUsername,
    telegramUsername,
  };
}
