export const baseEmailTemplate = (
  title: string,
  message: string,
  buttonText?: string,
  buttonLink?: string,
  footer?: string,
) => {
  const button = buttonLink
    ? `
  <div style="text-align:center;margin:30px 0;">
    <a href="${buttonLink}" style="background:#d4a536;color:#000;padding:14px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;">
      ${buttonText}
    </a>
  </div>`
    : '';

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body{
  background:#f4f6f9;
  font-family:Arial, Helvetica, sans-serif;
  padding:30px;
}
.container{
  max-width:600px;
  margin:auto;
  background:#ffffff;
  border-radius:10px;
  overflow:hidden;
}
.header{
  background:#2f3b52;
  text-align:center;
  padding:30px;
}
.content{
  padding:35px;
  color:#333;
}
.footer{
  background:#f3f3f3;
  padding:20px;
  text-align:center;
  font-size:13px;
  color:#666;
}
</style>
</head>

<body>

<div class="container">

<div class="header">
<img src="https://gogex.xyz/src/assets/mail-banner.png" width="auto" height="auto"/>
</div>

<div class="content">

<h2>${title}</h2>

<div style="line-height:1.7;font-size:15px;">
${message}
</div>

${button}

</div>

<div class="footer">
${footer || 'Vaultire Infinite | Secure. Smart. Scalable.'}<br>
www.vaultireinfinite.com
</div>

</div>

</body>
</html>
`;
};
