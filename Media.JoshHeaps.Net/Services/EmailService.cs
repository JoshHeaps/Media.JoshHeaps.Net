using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace Media.JoshHeaps.Net.Services;

public class EmailService(IConfiguration config, ILogger<EmailService> logger)
{
    public async Task<bool> SendVerificationEmailAsync(string toEmail, string username, string verificationToken)
    {
        try
        {
            var appUrl = config["AppUrl"] ?? "https://media.joshheaps.net";
            var verificationUrl = $"{appUrl}/VerifyEmail?token={verificationToken}";

            var message = new MimeMessage();
            message.From.Add(new MailboxAddress(
                config["Email:FromName"] ?? "Media App",
                config["Email:FromEmail"] ?? "noreply@example.com"
            ));
            message.To.Add(new MailboxAddress(username, toEmail));
            message.Subject = "Verify Your Email Address";

            var bodyBuilder = new BodyBuilder
            {
                HtmlBody = $@"
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                            .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }}
                            .content {{ background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }}
                            .button {{ display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }}
                            .footer {{ text-align: center; margin-top: 20px; color: #666; font-size: 12px; }}
                        </style>
                    </head>
                    <body>
                        <div class='container'>
                            <div class='header'>
                                <h1>Welcome, {username}!</h1>
                            </div>
                            <div class='content'>
                                <h2>Verify Your Email Address</h2>
                                <p>Thank you for registering! Please click the button below to verify your email address and activate your account.</p>
                                <p style='text-align: center;'>
                                    <a href='{verificationUrl}' class='button'>Verify Email Address</a>
                                </p>
                                <p>Or copy and paste this link into your browser:</p>
                                <p style='word-break: break-all; color: #667eea;'>{verificationUrl}</p>
                                <p style='margin-top: 30px; color: #666; font-size: 14px;'>
                                    This link will expire in 24 hours. If you didn't create an account, you can safely ignore this email.
                                </p>
                            </div>
                            <div class='footer'>
                                <p>&copy; {DateTime.UtcNow.Year} Media App. All rights reserved.</p>
                            </div>
                        </div>
                    </body>
                    </html>
                ",
                TextBody = $@"
Welcome, {username}!

Thank you for registering! Please verify your email address by visiting:
{verificationUrl}

This link will expire in 24 hours.

If you didn't create an account, you can safely ignore this email.
                "
            };

            message.Body = bodyBuilder.ToMessageBody();

            using var client = new SmtpClient();

            var smtpHost = config["Email:SmtpHost"];
            var smtpPort = int.Parse(config["Email:SmtpPort"] ?? "587");
            var smtpUsername = config["Email:SmtpUsername"];
            var smtpPassword = config["Email:SmtpPassword"];
            var enableSsl = bool.Parse(config["Email:EnableSsl"] ?? "true");

            await client.ConnectAsync(smtpHost, smtpPort, enableSsl ? SecureSocketOptions.StartTls : SecureSocketOptions.None);

            if (!string.IsNullOrEmpty(smtpUsername) && !string.IsNullOrEmpty(smtpPassword))
            {
                await client.AuthenticateAsync(smtpUsername, smtpPassword);
            }

            await client.SendAsync(message);
            await client.DisconnectAsync(true);

            logger.LogInformation($"Verification email sent to {toEmail}");
            return true;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, $"Failed to send verification email to {toEmail}");
            return false;
        }
    }

    public async Task<bool> SendPasswordResetEmailAsync(string toEmail, string username, string resetToken)
    {
        try
        {
            var appUrl = config["AppUrl"] ?? "http://localhost:5000";
            var resetUrl = $"{appUrl}/ResetPassword?token={resetToken}";

            var message = new MimeMessage();
            message.From.Add(new MailboxAddress(
                config["Email:FromName"] ?? "Media App",
                config["Email:FromEmail"] ?? "noreply@example.com"
            ));
            message.To.Add(new MailboxAddress(username, toEmail));
            message.Subject = "Password Reset Request";

            var bodyBuilder = new BodyBuilder
            {
                HtmlBody = $@"
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                            .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }}
                            .content {{ background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }}
                            .button {{ display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }}
                            .footer {{ text-align: center; margin-top: 20px; color: #666; font-size: 12px; }}
                        </style>
                    </head>
                    <body>
                        <div class='container'>
                            <div class='header'>
                                <h1>Password Reset</h1>
                            </div>
                            <div class='content'>
                                <h2>Reset Your Password</h2>
                                <p>Hello {username},</p>
                                <p>We received a request to reset your password. Click the button below to create a new password:</p>
                                <p style='text-align: center;'>
                                    <a href='{resetUrl}' class='button'>Reset Password</a>
                                </p>
                                <p>Or copy and paste this link into your browser:</p>
                                <p style='word-break: break-all; color: #667eea;'>{resetUrl}</p>
                                <p style='margin-top: 30px; color: #666; font-size: 14px;'>
                                    This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
                                </p>
                            </div>
                            <div class='footer'>
                                <p>&copy; {DateTime.UtcNow.Year} Media App. All rights reserved.</p>
                            </div>
                        </div>
                    </body>
                    </html>
                ",
                TextBody = $@"
Password Reset Request

Hello {username},

We received a request to reset your password. Visit the link below to create a new password:
{resetUrl}

This link will expire in 1 hour.

If you didn't request a password reset, you can safely ignore this email.
                "
            };

            message.Body = bodyBuilder.ToMessageBody();

            using var client = new SmtpClient();

            var smtpHost = config["Email:SmtpHost"];
            var smtpPort = int.Parse(config["Email:SmtpPort"] ?? "587");
            var smtpUsername = config["Email:SmtpUsername"];
            var smtpPassword = config["Email:SmtpPassword"];
            var enableSsl = bool.Parse(config["Email:EnableSsl"] ?? "true");

            await client.ConnectAsync(smtpHost, smtpPort, enableSsl ? SecureSocketOptions.StartTls : SecureSocketOptions.None);

            if (!string.IsNullOrEmpty(smtpUsername) && !string.IsNullOrEmpty(smtpPassword))
            {
                await client.AuthenticateAsync(smtpUsername, smtpPassword);
            }

            await client.SendAsync(message);
            await client.DisconnectAsync(true);

            logger.LogInformation($"Password reset email sent to {toEmail}");
            return true;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, $"Failed to send password reset email to {toEmail}");
            return false;
        }
    }
}
