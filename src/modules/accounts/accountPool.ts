import type { AccountSummary, CollectionSettings } from '../../shared/domain';

interface Reservation {
  account: AccountSummary;
  release(consumed: boolean): void;
}

export class AccountPool {
  private cursor = 0;
  private readonly reserved = new Map<string, number>();

  constructor(
    private readonly accounts: AccountSummary[],
    private readonly settings: CollectionSettings,
    private readonly onConsumed: (accountId: string) => void,
  ) {}

  reserve(): Reservation | null {
    const candidates = this.settings.accountMode === 'single' && this.settings.singleAccountId
      ? this.accounts.filter((account) => account.id === this.settings.singleAccountId)
      : this.accounts;

    for (let attempt = 0; attempt < candidates.length; attempt += 1) {
      const index = (this.cursor + attempt) % candidates.length;
      const account = candidates[index];
      if (!account || account.status !== 'healthy') continue;
      const inFlight = this.reserved.get(account.id) ?? 0;
      if (account.quota.used + inFlight >= account.quota.limit) continue;

      this.cursor = (index + 1) % candidates.length;
      this.reserved.set(account.id, inFlight + 1);
      let released = false;
      return {
        account,
        release: (consumed) => {
          if (released) return;
          released = true;
          this.reserved.set(account.id, Math.max(0, (this.reserved.get(account.id) ?? 1) - 1));
          if (consumed) {
            account.quota.used += 1;
            this.onConsumed(account.id);
          }
        },
      };
    }
    return null;
  }
}