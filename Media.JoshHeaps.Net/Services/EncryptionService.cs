using System.Security.Cryptography;

namespace Media.JoshHeaps.Net.Services;

public class EncryptionService
{
    private readonly byte[] _key;
    private readonly ILogger<EncryptionService> _logger;

    public EncryptionService(IConfiguration configuration, ILogger<EncryptionService> logger)
    {
        _logger = logger;
        var keyString = configuration["Encryption:Key"];

        if (string.IsNullOrEmpty(keyString))
        {
            throw new InvalidOperationException("Encryption key not configured in appsettings.json");
        }

        // Key must be 32 bytes for AES-256
        _key = Convert.FromBase64String(keyString);

        if (_key.Length != 32)
        {
            throw new InvalidOperationException("Encryption key must be 32 bytes (256 bits) for AES-256");
        }
    }

    /// <summary>
    /// Encrypts data using AES-256-CBC
    /// </summary>
    public async Task<byte[]> EncryptAsync(byte[] data)
    {
        try
        {
            using var aes = Aes.Create();
            aes.Key = _key;
            aes.Mode = CipherMode.CBC;
            aes.Padding = PaddingMode.PKCS7;
            aes.GenerateIV(); // Generate random IV for each encryption

            using var encryptor = aes.CreateEncryptor();
            using var msEncrypt = new MemoryStream();

            // Write IV to the beginning of the stream (needed for decryption)
            await msEncrypt.WriteAsync(aes.IV, 0, aes.IV.Length);

            using (var csEncrypt = new CryptoStream(msEncrypt, encryptor, CryptoStreamMode.Write))
            {
                await csEncrypt.WriteAsync(data, 0, data.Length);
                await csEncrypt.FlushFinalBlockAsync();
            }

            return msEncrypt.ToArray();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to encrypt data");
            throw;
        }
    }

    /// <summary>
    /// Decrypts data using AES-256-CBC
    /// </summary>
    public async Task<byte[]> DecryptAsync(byte[] encryptedData)
    {
        try
        {
            using var aes = Aes.Create();
            aes.Key = _key;
            aes.Mode = CipherMode.CBC;
            aes.Padding = PaddingMode.PKCS7;

            // Read IV from the beginning of the encrypted data
            var iv = new byte[16]; // AES block size is always 16 bytes
            Array.Copy(encryptedData, 0, iv, 0, iv.Length);
            aes.IV = iv;

            using var decryptor = aes.CreateDecryptor();
            using var msDecrypt = new MemoryStream(encryptedData, iv.Length, encryptedData.Length - iv.Length);
            using var csDecrypt = new CryptoStream(msDecrypt, decryptor, CryptoStreamMode.Read);
            using var msPlain = new MemoryStream();

            await csDecrypt.CopyToAsync(msPlain);
            return msPlain.ToArray();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to decrypt data");
            throw;
        }
    }

    /// <summary>
    /// Encrypts a file and saves it to the destination path
    /// </summary>
    public async Task EncryptFileAsync(string sourcePath, string destinationPath)
    {
        var data = await File.ReadAllBytesAsync(sourcePath);
        var encrypted = await EncryptAsync(data);
        await File.WriteAllBytesAsync(destinationPath, encrypted);
    }

    /// <summary>
    /// Decrypts a file and returns the data
    /// </summary>
    public async Task<byte[]> DecryptFileAsync(string filePath)
    {
        var encryptedData = await File.ReadAllBytesAsync(filePath);
        return await DecryptAsync(encryptedData);
    }

    /// <summary>
    /// Generates a new random encryption key (32 bytes for AES-256)
    /// </summary>
    public static string GenerateKey()
    {
        using var rng = RandomNumberGenerator.Create();
        var key = new byte[32];
        rng.GetBytes(key);
        return Convert.ToBase64String(key);
    }
}
