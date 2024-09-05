package utils;

// https://github.com/Mastercard/client-encryption-java/blob/main/src/main/java/com/mastercard/developer/utils/Crypto.java

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.GeneralSecurityException;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;

/**
 * Utility class for loading keys. one can also use bouncy castle
 */
public final class Crypto {
    private static final String PKCS_1_PEM_HEADER = "-----BEGIN RSA PRIVATE KEY-----";
    private static final String PKCS_1_PEM_FOOTER = "-----END RSA PRIVATE KEY-----";
    private static final String PKCS_8_PEM_HEADER = "-----BEGIN PRIVATE KEY-----";
    private static final String PKCS_8_PEM_FOOTER = "-----END PRIVATE KEY-----";

    public static PrivateKey loadKey(String keyFilePath)
            throws GeneralSecurityException, IOException {
        byte[] keyDataBytes = Files.readAllBytes(
                Paths.get(keyFilePath.replaceFirst("^~", System.getProperty("user.home"))));
        String keyDataString = new String(keyDataBytes, StandardCharsets.UTF_8);

        if (keyDataString.contains(PKCS_1_PEM_HEADER)) {
            // OpenSSL / PKCS#1 Base64 PEM encoded file
            keyDataString = keyDataString.replace(PKCS_1_PEM_HEADER, "");
            keyDataString = keyDataString.replace(PKCS_1_PEM_FOOTER, "");
            return readPkcs1PrivateKey(Base64.getMimeDecoder().decode(keyDataString));
        } else if (keyDataString.contains(PKCS_8_PEM_HEADER)) {
            // PKCS#8 Base64 PEM encoded file
            keyDataString = keyDataString.replace(PKCS_8_PEM_HEADER, "");
            keyDataString = keyDataString.replace(PKCS_8_PEM_FOOTER, "");
            return readPkcs8PrivateKey(Base64.getMimeDecoder().decode(keyDataString));
        }

        // We assume it's a PKCS#8 DER encoded binary file
        return readPkcs8PrivateKey(Files.readAllBytes(Paths.get(keyFilePath)));
    }

    private static PrivateKey readPkcs8PrivateKey(byte[] pkcs8Bytes)
            throws GeneralSecurityException {
        KeyFactory keyFactory = KeyFactory.getInstance("RSA", "SunRsaSign");
        PKCS8EncodedKeySpec keySpec = new PKCS8EncodedKeySpec(pkcs8Bytes);
        return keyFactory.generatePrivate(keySpec);
    }

    private static PrivateKey readPkcs1PrivateKey(byte[] pkcs1Bytes)
            throws GeneralSecurityException {
        // We can't use Java internal APIs to parse ASN.1 structures,
        // so we build a PKCS#8 key Java can understand
        int pkcs1Length = pkcs1Bytes.length;
        int totalLength = pkcs1Length + 22;
        byte[] pkcs8Header = new byte[] { //
                // Sequence + total length
                0x30, (byte) 0x82, (byte) ((totalLength >> 8) & 0xff), (byte) (totalLength & 0xff), //
                // Integer (0)
                0x2, 0x1, 0x0, //
                // Sequence: 1.2.840.113549.1.1.1, NULL
                0x30, 0xD, 0x6, 0x9, 0x2A, (byte) 0x86, 0x48, (byte) 0x86, (byte) 0xF7, 0xD, 0x1,
                0x1, 0x1, 0x5, 0x0, //
                // Octet string + length
                0x4, (byte) 0x82, (byte) ((pkcs1Length >> 8) & 0xff), (byte) (pkcs1Length & 0xff)};
        byte[] pkcs8bytes = join(pkcs8Header, pkcs1Bytes);
        return readPkcs8PrivateKey(pkcs8bytes);
    }

    private static byte[] join(byte[] byteArray1, byte[] byteArray2) {
        byte[] bytes = new byte[byteArray1.length + byteArray2.length];
        System.arraycopy(byteArray1, 0, bytes, 0, byteArray1.length);
        System.arraycopy(byteArray2, 0, bytes, byteArray1.length, byteArray2.length);
        return bytes;
    }
}
