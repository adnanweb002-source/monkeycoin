// dto/credit.dto.ts
export class CreditDto {
  userId: number;
  walletType: 'D_WALLET' | 'P_WALLET' | 'E_WALLET' | 'A_WALLET';
  amount: string; // decimal as string to avoid precision loss
  type: 'DEPOSIT' | 'BINARY_INCOME' | 'ROI_CREDIT' | 'RANK_REWARD' | 'ADJUSTMENT';
  purpose?: string;
  meta?: Record<string, any>;
}

// dto/debit.dto.ts
export class DebitDto {
  userId: number;
  walletType: 'D_WALLET' | 'P_WALLET' | 'E_WALLET' | 'A_WALLET';
  amount: string;
  type: 'WITHDRAW' | 'TRANSFER_OUT' | 'PACKAGE_PURCHASE' | 'ADJUSTMENT';
  purpose?: string;
  meta?: Record<string, any>;
}

// dto/transfer.dto.ts
export class TransferDto {
  fromUserId: number;
  fromWalletType: 'D_WALLET' | 'P_WALLET' | 'E_WALLET' | 'A_WALLET';
  toMemberId: string; // recipient memberId
  amount: string;
  twoFactorCode?: string; // optional, validate prior to call
}
