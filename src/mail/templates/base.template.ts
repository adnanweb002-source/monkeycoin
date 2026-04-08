export const baseEmailTemplate = (
  title: string,
  message: string,
  buttonText?: string,
  buttonLink?: string,
  footer?: string,
) => {
  const button = buttonLink
    ? `
<tr>
<td align="center" style="padding:20px 0;">
<a href="${buttonLink}" style="
background:#d4a536;
color:#000;
text-decoration:none;
padding:12px 22px;
border-radius:4px;
font-weight:bold;
display:inline-block;
font-size:14px;">
${buttonText}
</a>
</td>
</tr>
`
    : '';

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" border="0">
<tr>
<td align="center">

<table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">

<!-- HEADER -->
<tr>
<td align="center" style="padding:20px 0;border-bottom:1px solid #eee;">
<img src="https://vaultireinfinite.com/panel/src/assets/logo-light.png" width="140" style="display:block;border:0;">
</td>
</tr>

<!-- CONTENT -->
<tr>
<td style="padding:30px 40px;color:#333;font-size:14px;line-height:1.6;">

<h2 style="margin:0 0 18px 0;font-size:20px;color:#111;">
${title}
</h2>

${message}

</td>
</tr>

${button}


<!-- FOOTER -->
<tr>
<td align="center" style="background:#1f2937;padding:20px;color:#cbd5e1;font-size:12px;">

<div style="margin-bottom:10px;">
This email is confidential and intended only for the recipient.<br>
Vaultire Infinite will never ask for your password or private keys via email.
</div>

<table cellpadding="0" cellspacing="0" align="center">
<tr>
<td><a href="https://www.facebook.com/profile.php?id=61586453837955"><img src="https://cdn-icons-png.flaticon.com/512/733/733547.png" width="20"></a></td>
<td width="10"></td>
<td><a href="https://www.instagram.com/vaultireinfinite/"><img src="https://cdn-icons-png.flaticon.com/512/2111/2111463.png" width="20"></a></td>
<td width="10"></td>
<td><a href="https://t.me/vaultireinfinite"><img src="https://cdn-icons-png.flaticon.com/512/2111/2111646.png" width="20"></a></td>
<td width="10"></td>
<td><a href="https://wa.link/8rhovc"><img src="https://cdn-icons-png.flaticon.com/512/733/733585.png" width="20"></a></td>
</tr>
</table>

<div style="margin-top:10px;">
${footer || 'Vaultire Infinite | Secure. Smart. Scalable.'}<br>
</div>

</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>`;
};
