import {
  createRequestRetryPolicy as createSharedRequestRetryPolicy,
} from "../../../shared/requests/authenticated-request-lifecycle.ts";

export {
  createAuthenticatedRequestIdentity,
  createAuthenticatedScopedRequestKey,
  createLatestAuthenticatedRequestGuard,
  createLatestAuthenticatedScopedRequestGuard,
  isSameAuthenticatedRequestIdentity,
  isSameAuthenticatedScopedRequestKey,
  type AuthenticatedRequestIdentity,
  type AuthenticatedScopedRequestKey,
} from "../../../shared/requests/authenticated-request-lifecycle.ts";

type AccountsRequestLoadAdmission = Readonly<{
  coalescesWithActiveFlight: boolean;
  resetRetryCount: boolean;
}>;

export function createRequestRetryPolicy(maxRetries: number) {
  const policy = createSharedRequestRetryPolicy(maxRetries);

  return {
    admitLoad(options: AccountsRequestLoadAdmission): boolean {
      return policy.admitLoad(options);
    },
    reserveRetry(): boolean {
      return policy.reserveRetry();
    },
    reset() {
      policy.reset();
    },
  };
}
