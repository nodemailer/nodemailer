const nodemailer = require('nodemailer');

// Generate test SMTP service account from ethereal.email
// Only needed if you don't have a real mail account for testing
(async function sendTestMail () {
  console.log("Creating email account")
  let account = await nodemailer.createTestAccount()

  // create reusable transporter object using the default SMTP transport
  let transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: account.user, // generated ethereal user
      pass: account.pass  // generated ethereal password
    }
  })

  // setup email data with unicode symbols
  let mailOptions = {
    from: '"Fred Foo 👻" <foo@example.com>', // sender address
    to: 'bar@example.com, baz@example.com', // list of receivers
    subject: 'Hello ✔', // Subject line
    text: 'Hello world?', // plain text body
    html: '<b>Hello world?</b>' // html body
  };

  // send mail with defined transport object
  console.log("sending...")
  let info = await transporter.sendMail(mailOptions)
  console.log(`Message sent: ${info.messageId}`);
  // Preview only available when sending through an Ethereal account
  console.log(`Preview URL: ${nodemailer.getTestMessageUrl(info)}`);

  // Message sent: <b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com>
  // Preview URL: https://ethereal.email/message/WaQKMgKddxQDoou...
  console.log(account)
  console.log(info)
  
})()
