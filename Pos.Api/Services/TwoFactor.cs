using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Pos.Api.Services;

// ============================================================
// 2-STEP SIGN-IN
//
// The back office (email + password) can ask for a second step: a 6-digit code from an
// authenticator app — Google Authenticator, Microsoft Authenticator, Authy. It is the standard
// time-based code (RFC 6238), so it needs no SMS or email service and costs nothing to run. A
// till's PIN sign-in never asks: the till is already a trusted, paired device, as with Toast.
//
// The shared secret is kept encrypted with a key derived from the server secret, so a copy of the
// database alone cannot produce codes. Recovery codes are kept only as hashes and work once.
// ============================================================

public static class TwoFactorCodes
{
    private const int StepSeconds = 30;
    private const int Digits = 6;
    private const string Base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    /// <summary>A new random secret, Base32 as authenticator apps expect it.</summary>
    public static string NewSecret() => Base32Encode(RandomNumberGenerator.GetBytes(20));

    /// <summary>What an authenticator app scans (the otpauth:// address inside the QR code).</summary>
    public static string SetupUri(string secret, string accountEmail, string issuer = "Cashly POS") =>
        $"otpauth://totp/{Uri.EscapeDataString(issuer)}:{Uri.EscapeDataString(accountEmail)}" +
        $"?secret={secret}&issuer={Uri.EscapeDataString(issuer)}&algorithm=SHA1&digits={Digits}&period={StepSeconds}";

    public static long CurrentStep() => DateTimeOffset.UtcNow.ToUnixTimeSeconds() / StepSeconds;

    /// <summary>
    /// The step a code belongs to, when it is right for now or the step either side (a phone clock
    /// a little off), and later than the last code accepted — so a code works once. Null otherwise.
    /// </summary>
    public static long? Verify(string secret, string? code, long lastUsedStep)
    {
        code = new string((code ?? "").Where(char.IsDigit).ToArray());
        if (code.Length != Digits) return null;
        var key = Base32Decode(secret);
        var now = CurrentStep();
        for (var step = now - 1; step <= now + 1; step++)
        {
            if (step <= lastUsedStep) continue;
            if (CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(CodeAt(key, step)), Encoding.ASCII.GetBytes(code)))
                return step;
        }
        return null;
    }

    private static string CodeAt(byte[] key, long step)
    {
        var counter = BitConverter.GetBytes(step);
        if (BitConverter.IsLittleEndian) Array.Reverse(counter);
        using var hmac = new HMACSHA1(key);
        var hash = hmac.ComputeHash(counter);
        var offset = hash[^1] & 0x0F;
        var binary = ((hash[offset] & 0x7F) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
        return (binary % (int)Math.Pow(10, Digits)).ToString().PadLeft(Digits, '0');
    }

    private static string Base32Encode(byte[] data)
    {
        var sb = new StringBuilder();
        int buffer = 0, bits = 0;
        foreach (var b in data)
        {
            buffer = (buffer << 8) | b;
            bits += 8;
            while (bits >= 5)
            {
                sb.Append(Base32Alphabet[(buffer >> (bits - 5)) & 31]);
                bits -= 5;
            }
        }
        if (bits > 0) sb.Append(Base32Alphabet[(buffer << (5 - bits)) & 31]);
        return sb.ToString();
    }

    private static byte[] Base32Decode(string text)
    {
        var bytes = new List<byte>();
        int buffer = 0, bits = 0;
        foreach (var c in text.Trim().TrimEnd('=').ToUpperInvariant())
        {
            var value = Base32Alphabet.IndexOf(c);
            if (value < 0) continue;
            buffer = (buffer << 5) | value;
            bits += 5;
            if (bits >= 8)
            {
                bytes.Add((byte)((buffer >> (bits - 8)) & 0xFF));
                bits -= 8;
            }
        }
        return bytes.ToArray();
    }

    // --- Recovery codes: for a lost phone. Shown once, stored as hashes, each works once. ---

    public static List<string> NewRecoveryCodes(int count = 8)
    {
        const string alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
        return Enumerable.Range(0, count).Select(_ =>
        {
            var chars = Enumerable.Range(0, 8).Select(__ => alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)]).ToArray();
            return $"{new string(chars, 0, 4)}-{new string(chars, 4, 4)}";
        }).ToList();
    }

    public static string HashRecoveryCode(string code) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(NormalizeRecoveryCode(code))));

    public static string SerializeHashes(IEnumerable<string> codes) =>
        JsonSerializer.Serialize(codes.Select(HashRecoveryCode).ToList());

    /// <summary>Uses up a recovery code: the remaining hashes when it matched, null when it did not.</summary>
    public static string? ConsumeRecoveryCode(string? storedHashes, string? code)
    {
        if (string.IsNullOrWhiteSpace(storedHashes) || string.IsNullOrWhiteSpace(code)) return null;
        var hashes = JsonSerializer.Deserialize<List<string>>(storedHashes) ?? new List<string>();
        var hash = HashRecoveryCode(code);
        if (!hashes.Remove(hash)) return null;
        return JsonSerializer.Serialize(hashes);
    }

    public static int CountRecoveryCodes(string? storedHashes) =>
        string.IsNullOrWhiteSpace(storedHashes) ? 0 : (JsonSerializer.Deserialize<List<string>>(storedHashes)?.Count ?? 0);

    private static string NormalizeRecoveryCode(string code) =>
        new string(code.Trim().ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());
}

/// <summary>Encrypts small secrets (the 2-step secret) with a key derived from the server secret.</summary>
public sealed class SecretProtector
{
    private readonly byte[] _key;

    public SecretProtector(string serverSecret)
    {
        _key = SHA256.HashData(Encoding.UTF8.GetBytes("cashly-secret-protector:" + serverSecret));
    }

    public string Protect(string plain)
    {
        var nonce = RandomNumberGenerator.GetBytes(12);
        var plainBytes = Encoding.UTF8.GetBytes(plain);
        var cipher = new byte[plainBytes.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(_key, 16);
        aes.Encrypt(nonce, plainBytes, cipher, tag);
        return Convert.ToBase64String(nonce.Concat(cipher).Concat(tag).ToArray());
    }

    public string? Unprotect(string? protectedValue)
    {
        if (string.IsNullOrWhiteSpace(protectedValue)) return null;
        try
        {
            var all = Convert.FromBase64String(protectedValue);
            var nonce = all[..12];
            var tag = all[^16..];
            var cipher = all[12..^16];
            var plain = new byte[cipher.Length];
            using var aes = new AesGcm(_key, 16);
            aes.Decrypt(nonce, cipher, tag, plain);
            return Encoding.UTF8.GetString(plain);
        }
        catch
        {
            // Wrong key (the server secret changed) or damaged: the 2-step setup has to be redone.
            return null;
        }
    }
}
