import { baseEmailTemplate } from "./base.template";

export const EmailTemplates = {

/* 1 REGISTRATION */

registration: (
name:string,
username:string,
password: string,
loginLink:string
) =>
baseEmailTemplate(
"Welcome Aboard! Your Vaultire Infinite Account is Ready",

`Hi <b>${name}</b>,<br><br>

Congratulations! Your Vaultire Infinite account has been successfully created. You are now part of a global digital banking and crypto community. <br>

<b>Account Details</b><br>
Username: ${username}<br>
Password: ${password}

<br>

<b>Next Steps:</b>
<ul>
<li>Transaction Password</li>
<li>Google 2FA (G2FA)</li>
</ul>`,

"Login & Secure Account",
loginLink,
"Vaultire Infinite | Protecting Your Digital Wealth Every Step<br>www.vaultireinfinite.com"
),


/* 2 FORGOT PASSWORD */

forgotPassword: (
name:string,
resetLink:string
) =>
baseEmailTemplate(
"Reset Your Vaultire Infinite Password",

`Hi ${name},<br><br>

We received a request to reset your password. Click below to create a new secure password. <br>

<br><br>
Note: This link expires in <b>30 minutes</b>. If you did not request this, ignore this email or contact our support.`,

"Reset Password",
resetLink,
"Vaultire Infinite Security | Only trust emails from vaultireinfinite.com<br>"
),


/* 3 PASSWORD CHANGE */

passwordChanged: (
name:string,
date:string,
ip:string,
location:string
) =>
baseEmailTemplate(
"Your Vaultire Infinite Password Was Successfully Updated",

`Hi ${name},<br><br>

Your password has been changed successfully. <br>

<b>Activity Details:</b><br>
Date/Time: ${date}<br>
IP Address: ${ip}<br>
Location: ${location}

<br>
If you did not authorize this, secure your account immediately.`,

undefined,
undefined,
"Vaultire Infinite Support | Keep your credentials unique and secure<br>www.vaultireinfinite.com"
),


/* 4 G2FA RESET REQUEST */

g2faResetRequest: (
name:string,
timeframe:string
) =>
baseEmailTemplate(
"G2FA Reset Request Under Review",

`Dear ${name},<br><br>

Your request to reset Google 2FA (G2FA) is under manual review. Our security team will verify your identity within ${timeframe}. <br>`, 

undefined,
undefined,
"Vaultire Infinite Compliance | Never share recovery seeds or private keys<br>www.vaultireinfinite.com"
),


/* 5 G2FA VERIFICATION */

g2faVerification: (
name:string,
code:string
) =>
baseEmailTemplate(
"Verify Your G2FA Action",

`Hi ${name},<br><br>

You are making changes to your Google 2FA settings. Use the code below to confirm: <br>

<b>Verification Code:</b> ${code}

<br><br>
If this wasn’t you, secure your account immediately.`,

undefined,
undefined,
"Vaultire Infinite Global | Privacy Policy<br>www.vaultireinfinite.com"
),


/* 6 G2FA ENABLED */

g2faEnabled: (
name:string,
date:string,
ip:string
) =>
baseEmailTemplate(
"G2FA Successfully Enabled",

`Hello ${name},<br><br>

Good news! Google 2FA is now enabled for your login. Your account has an added layer of protection. <br>

<b>Details:</b><br>
Timestamp: ${date}<br>
IP Address: ${ip}`,

undefined,
undefined,
"Vaultire Infinite Security | Store your backup key safely offline<br>www.vaultireinfinite.com"
),


/* 7 G2FA DISABLED */

g2faDisabled: (
name:string
) =>
baseEmailTemplate(
"⚠️ G2FA Disabled – Immediate Action Required",

`Hi ${name},<br><br>

Google 2FA has been disabled for your account. If you did not authorize this, log in and re-enable G2FA or freeze your account immediately. <br>`,

undefined,
undefined,
"Vaultire Infinite Security | Contact support@vaultireinfinite.com if this wasn’t you<br>www.vaultireinfinite.com"
),


/* 8 PROFILE UPDATE */

profileUpdated: (
name:string,
date:string,
ip:string,
oldDetails: string,
newDetails: string
) =>
baseEmailTemplate(
"Your Profile Has Been Updated",

`Hello ${name},<br><br>

Your profile information was updated. <br>

<b>Details:</b><br>
Old Details: <br> ${oldDetails} <br> <br>
New Details: <br> ${newDetails} <br> <br>
Change Date: ${date}<br>
IP Address: ${ip}

<br>
If you did not authorize this, lock your account immediately.`,

undefined,
undefined,
"Vaultire Infinite Admin | Keep your account info secure<br>www.vaultireinfinite.com"
),


/* 9 WITHDRAWAL ADDRESS CHANGE */

withdrawalAddressChanged: (
name:string,
address:string
) =>
baseEmailTemplate(
"⚠️ Withdrawal Address Changed",

`Hi ${name},<br><br>

Your withdrawal wallet address has been updated: <br>

<b>New Address:</b> ${address}

<br><br>
If this wasn’t you, freeze your withdrawals immediately.`,

undefined,
undefined,
"Vaultire Infinite Security | Protect your funds instantly<br>www.vaultireinfinite.com"
),


/* 10 DEPOSIT */

deposit: (
name:string,
amount:string,
currency:string,
txid:string,
balance:string
) =>
baseEmailTemplate(
"Deposit Successful – Funds Added",

`Hi ${name},<br><br>

Your deposit has been confirmed and credited to your Vaultire Infinite Deposit Wallet. <br>

<b>Deposit Details:</b><br>
Amount: ${amount} ${currency}<br>
Transaction ID: ${txid}<br>
Wallet Balance: ${balance}`,

undefined,
undefined,
"Vaultire Infinite Treasury | Always secure your wallet<br>www.vaultireinfinite.com"
),


/* 11 PACKAGE PURCHASE SELF */

packageSelf: (
name:string,
packageName:string,
amount:string,
txid:string,
wallets:string,
date:string,
dashboardLink:string
) =>
baseEmailTemplate(
`${packageName} Activated Successfully`,

`Congratulations ${name},<br><br>

Your ${packageName} purchase has been processed. <br>

<b>Summary:</b><br>
Package: ${packageName}<br>
Amount: ${amount}<br>
Transaction ID: ${txid}<br>
Wallets Used: ${wallets}<br>
Activation Date: ${date}

<br>
Track your daily rewards in your dashboard.`,

"Go to Dashboard",
dashboardLink,
"Vaultire Infinite | Empowering Your Digital Wealth<br>www.vaultireinfinite.com"
),


/* 12 PACKAGE PURCHASE BY OTHERS */

packageAssigned: (
name:string,
packageName:string,
sender:string,
amount:string
) =>
baseEmailTemplate(
"New Package Added to Your Account",

`Hi ${name},<br><br>

A ${packageName} has been assigned to your account by ${sender}. <br>

Amount: ${amount}`,

undefined,
undefined,
"Vaultire Infinite Management | Stay ahead with your rewards<br>www.vaultireinfinite.com"
),


/* 13 PACKAGE PURCHASE FOR OTHERS */

packagePurchasedForOther: (
name:string,
recipient:string,
packageName:string,
amount:string,
txid:string,
wallets:string
) =>
baseEmailTemplate(
`You Purchased a Package for ${recipient}`,

`Hello ${name},<br><br>

You successfully purchased ${packageName} for ${recipient} <br>.

<b>Details:</b><br>
Recipient: ${recipient}<br>
Package: ${packageName}<br>
Amount: ${amount}<br>
Transaction ID: ${txid}<br>
Wallets Used: ${wallets}`,

undefined,
undefined,
"Vaultire Infinite Finance | Supporting your team’s growth<br>www.vaultireinfinite.com"
),


/* 14 FUND TRANSFER */

fundTransfer: (
name:string,
recipient:string,
amount:string,
wallet:string,
txid:string,
balance:string
) =>
baseEmailTemplate(
"Funds Sent Successfully",

`Hi ${name},<br><br>

You sent funds from your wallet successfully. <br>

<b>Details:</b><br>
Recipient: ${recipient}<br>
Amount: ${amount} (${wallet})<br>
Transaction ID: ${txid}<br>
Remaining Balance: ${balance} (${wallet})`,

undefined,
undefined,
"Vaultire Infinite Finance | Verify recipient info before sending<br>www.vaultireinfinite.com"
),


/* 15 FUND RECEIVED */

fundReceived: (
name:string,
sender:string,
amount:string,
wallet:string,
balance:string
) =>
baseEmailTemplate(
"Funds Received",

`Hello ${name},<br><br>

You have received a transfer in your Vaultire Infinite wallet. <br>

<b>Details:</b><br>
From: ${sender}<br>
Amount Received: ${amount} (${wallet})<br>
Total Balance: ${balance} (${wallet})`,

undefined,
undefined,
"Vaultire Infinite Finance | Track all transactions in Wallet Overview<br>www.vaultireinfinite.com"
),


/* 16 REFERRAL INCOME */

referralIncome: (
name:string,
amount:string,
partner:string,
balance:string
) =>
baseEmailTemplate(
"New Referral Earnings Credited!",

`Hi ${name},<br><br>

You earned ${amount} from your direct partner ${partner}. <br>

Affiliate Wallet Balance: ${balance}`,

undefined,
undefined,
"Vaultire Infinite Rewards | Grow your network, grow your wealth<br>www.vaultireinfinite.com"
),


/* 17 BINARY INCOME */

binaryIncome: (
name:string,
amount:string,
left:string,
right:string,
balance:string
) =>
baseEmailTemplate(
"Binary Earnings Notification",

`Hi ${name},<br><br>

Your team-building efforts have earned you: <br>

Binary Earnings: ${amount} <br>

Matching Volume:<br>
Left: ${left} PV<br>
Right: ${right} PV <br>

Affiliate Wallet Balance: ${balance}`,

undefined,
undefined,
"Vaultire Infinite Team | Past performance is not indicative of future results<br>www.vaultireinfinite.com"
),


/* 18 REPURCHASE BONUS */

repurchaseBonus: (
name:string,
amount:string
) =>
baseEmailTemplate(
"Repurchase Bonus Credited",

`Hi ${name},<br><br>

A Repurchase Bonus of ${amount} has been credited to your Reward Wallet due to recent purchases via Affiliate and Profit Wallets. <br>` ,

undefined,
undefined,
"Vaultire Infinite Rewards Team | Collaboration drives success<br>www.vaultireinfinite.com"
),


/* 19 RANK ACHIEVED */

rankAchieved: (
name:string,
rank:string,
reward:string
) =>
baseEmailTemplate(
`Congratulations! New Rank Achieved: ${rank} 🏆 <br>`,

`Hi ${name},<br><br>

Your dedication earned you the rank ${rank} <br>.

Reward: ${reward}`,

undefined,
undefined,
"Vaultire Infinite Global | Excellence is a mindset<br>www.vaultireinfinite.com"
),


/* 20 CAPITAL RETURN */

capitalReturn: (
name:string,
packageName:string,
amount:string,
date:string
) =>
baseEmailTemplate(
"Investment Matured – Capital Returned",

`Hello ${name},<br><br>

Your investment in ${packageName} has matured. Initial capital returned to your wallet <br>.

Amount Returned: ${amount}<br>
Date: ${date}`,

undefined,
undefined,
"Vaultire Infinite Treasury | Ready to reinvest and grow<br>www.vaultireinfinite.com"
),


/* 21 ROC */

rocCredit: (
name:string,
amount:string,
balance:string
) =>
baseEmailTemplate(
"Reward on Capital (ROC) Credited",

`Hi ${name},<br><br>

Your Reward on Capital (ROC) has been credited for the recent period <br>.

Reward Amount: ${amount}<br>
Wallet Balance: ${balance}`,

undefined,
undefined,
"Vaultire Infinite Finance | Your capital works smarter with us<br>www.vaultireinfinite.com"
),


/* 22 WITHDRAWAL REQUEST */

withdrawalRequest: (
name:string,
amount:string,
wallet:string,
address:string
) =>
baseEmailTemplate(
"Withdrawal Request Initiated",

`Hi ${name},<br><br>

A withdrawal request has been initiated from your account <br>.

Amount: ${amount} (${wallet})<br>
Destination: ${address}<br>
Status: Requested

<br>
If you did not initiate this, use 2FA override or contact support.`,

undefined,
undefined,
"Vaultire Infinite Payments | Always double-check wallet addresses<br>www.vaultireinfinite.com"
),


/* 23 WITHDRAWAL PROCESSED */

withdrawalProcessed: (
name:string,
amount:string,
wallet:string
) =>
baseEmailTemplate(
"Withdrawal Successful – Funds Dispatched",

`Hello ${name},<br><br>

Your withdrawal has been processed and sent to the blockchain <br>.

Amount: ${amount}<br>
Wallet: ${wallet}<br>
Status: Processed <br>

Note: Blockchain confirmations may take time depending on network congestion.`,

undefined,
undefined,
"Vaultire Infinite Finance | Allow time for blockchain confirmations<br>www.vaultireinfinite.com"
),


/* 24 WITHDRAWAL CANCEL */

withdrawalCancelled: (
name:string,
amount:string,
reason:string,
balance:string
) =>
baseEmailTemplate(
"Withdrawal Request Cancelled",

`Hi ${name},<br><br>
 
Your withdrawal request of ${amount} has been cancelled <br>.

Reason: ${reason}<br>
Wallet Balance: ${balance}`,

undefined,
undefined,
"Vaultire Infinite Finance | Need assistance? Contact our support desk<br>www.vaultireinfinite.com"
),


/* 25 LEADERBOARD */

leaderboard: (
name:string,
tableHtml:string,
rank:string,
volume:string,
nextRankAmount:string,
nextRank:string
) =>
baseEmailTemplate(
"🏆 Monthly Global Leaderboard – See Where You Stand! <br>",

`Hi ${name},<br><br>

Our Vaultire Infinite community is thriving! Here are this month’s top performers <br>:

${tableHtml}

<br>

<b>Your Standing:</b><br>
Rank: #${rank}<br>
Team Volume: ${volume}<br>
To Next Rank: ${nextRankAmount} to reach ${nextRank}

<br><br>
Top 3 performers receive exclusive Global Profit Share bonuses and VIP pool access.`,

undefined,
undefined,
"Vaultire Infinite Achievements | Leaders create trends<br>www.vaultireinfinite.com"
)

};