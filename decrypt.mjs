import CryptoJS from "crypto-js";

export function decryptSecret(encrypted, key) {
  const bytes = CryptoJS.AES.decrypt(encrypted, key);
  const result = bytes.toString(CryptoJS.enc.Utf8);

  console.log("Raw bytes:", bytes.toString());
  console.log("Decrypted:", result);

  return result;
}

const decrypted = decryptSecret(
  "U2FsdGVkX18liWnZPhj5zfC6NsXeyUXPe/R9cvuWqjmPHN41CvHYHp6shZE5dbm7rQUR0sX62aXU1SohyVWeEg==",
  "32_byte_base64_SRVRGT1JSRUZSRVNIVE9LRU5GT1JQUk9EVUNUSU9OMTgyMTIxJCQkJCEhQ_or_hex_key"
);

console.log("Final:", decrypted)