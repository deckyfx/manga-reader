import * as deepl from "deepl-node";
import { envConfig } from "../env-config";
import { catchError, catchErrorSync } from "../lib/error-handler";

/**
 * Translation Service using DeepL API
 *
 * Singleton service for translating text using DeepL
 * Falls back gracefully if API key is not available
 */
export class TranslationService {
  private static instance: TranslationService;
  private translator: deepl.Translator | null = null;
  private hasApiKey: boolean = false;

  private constructor() {
    this.initialize();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): TranslationService {
    if (!TranslationService.instance) {
      TranslationService.instance = new TranslationService();
    }
    return TranslationService.instance;
  }

  /**
   * Initialize DeepL translator if API key is available
   */
  private initialize(): void {
    const [error, apiKey] = catchErrorSync(() => envConfig.DEEPL_API_KEY);

    if (error) {
      console.log("⚠️ DeepL API key not configured, translation disabled");
      this.hasApiKey = false;
      return;
    }

    if (apiKey) {
      this.translator = new deepl.Translator(apiKey);
      this.hasApiKey = true;
      console.log("✅ DeepL Translation Service initialized");
    }
  }

  /**
   * Translate text from Japanese to English
   * @param text - Text to translate
   * @returns Translated text or empty string if translation unavailable
   */
  public async translate(text: string): Promise<string> {
    // Return empty string if no API key or empty input
    if (!this.hasApiKey || !this.translator || !text.trim()) {
      return "";
    }

    const [error, result] = await catchError(
      this.translator.translateText(
        text,
        "ja", // Source language: Japanese
        "en-US", // Target language: English (US)
      ),
    );

    if (error) {
      console.error("Translation error:", error);
      return "";
    }

    return result.text;
  }

  /**
   * Check if translation service is available
   */
  public isAvailable(): boolean {
    return this.hasApiKey;
  }
}
