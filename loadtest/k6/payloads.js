export function randomDigits(count = 10) {
  let s = '';
  for (let i = 0; i < count; i++) s += Math.floor(Math.random() * 10);
  return s;
}

export function makeRegisterDto(i) {
  const firstName = `Load${i}`;
  const lastName = `Test${i}`;
  const email = `loadtest+${i}_${Date.now()}_${Math.floor(Math.random() * 1000)}@example.com`;
  const phone = `+1555${randomDigits(6)}`;

  return {
    firstName,
    lastName,
    phone,
    country: 'CA',
    email,
    password: __ENV.LOADTEST_USER_PASSWORD || 'LoadTest_Passw0rd!',
    // sponsorMemberId/parentMemberId intentionally omitted (defaults to COMPANY root)
    // position optional; default placement logic picks LEFT/RIGHT
  };
}

export function makeWithdrawalDto(userId, walletType = 'P_WALLET') {
  return {
    userId,
    walletType,
    amount: '1.00',
    method: 'USDT_TRX',
    address: `T${Math.floor(Math.random() * 1e10)}`,
  };
}

