import { GoogleGenAI } from '@google/genai';
import { LLMProvider, RecommendationContext } from './LLMProvider';
import { StructuredRecommendation, safeParseStructuredRecommendation } from './recommendationSchema';
import { MockProvider } from './MockProvider';

const MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-pro'];

function buildPrompt(context: RecommendationContext): string {
  return `
أنت وكيل تحليل تشغيلي لنظام "مَسارَا MASARA" للنقل المدرسي. لديك أرقام تنبؤ محسوبة مسبقاً (وليس من صلاحيتك حسابها)، ودورك هو الشرح واقتراح إجراء ضمن المخطط المحدد فقط.

بيانات الرحلة:
- المشكلة المرصودة: ${context.problem}
- الحافلة: ${context.busNumber} (السائق: ${context.driverName})
- التأخير المتوقع (دقائق، محسوب مسبقاً): ${context.delayMinutes}
- احتمال التأخير (محسوب مسبقاً): ${context.delayProbability}
- مستوى الخطورة (محسوب مسبقاً): ${context.riskLevel}
- مسار بديل متاح: ${context.alternativeRouteId ? `${context.alternativeRouteName} (id: ${context.alternativeRouteId}, تحسين متوقع ${context.alternativeImprovementMins} دقيقة)` : 'لا يوجد'}
- حوادث مفتوحة على الرحلة: ${context.openIncidentDescriptions.length ? context.openIncidentDescriptions.join('؛ ') : 'لا يوجد'}

أعد الاستجابة بصيغة JSON فقط مطابقة تماماً لهذا المخطط (لا تضف حقولاً إضافية):
{
  "problem": string,
  "severity": "low" | "medium" | "high" | "critical",
  "prediction": { "delayMinutes": number, "probability": number },
  "recommendation": {
    "action": "CHANGE_ROUTE" | "NOTIFY_SCHOOL" | "FLAG_INCIDENT" | "NO_ACTION",
    "targetId": string | null,
    "reason": string
  },
  "requiresApproval": boolean
}

يجب أن تكون قيم "delayMinutes" و "probability" مطابقة تماماً للأرقام المحسوبة مسبقاً أعلاه — أنت تشرح وتبرر فقط، لا تُعِد حسابها.
`.trim();
}

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  private readonly fallback = new MockProvider();

  private getClient(): GoogleGenAI | null {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
    return new GoogleGenAI({ apiKey });
  }

  async generateRecommendation(context: RecommendationContext): Promise<StructuredRecommendation> {
    const client = this.getClient();
    if (!client) {
      console.warn('[GeminiProvider] No GEMINI_API_KEY configured — falling back to MockProvider.');
      return this.fallback.generateRecommendation(context);
    }

    const prompt = buildPrompt(context);

    for (const model of MODELS) {
      try {
        const response = await client.models.generateContent({
          model,
          contents: prompt,
          config: { responseMimeType: 'application/json' },
        });

        if (!response.text) continue;

        const parsed = safeParseStructuredRecommendation(JSON.parse(response.text));
        if (parsed.success) {
          // The prediction numbers are always overwritten by the engine's values —
          // the LLM explains them, it never overrides them (spec §9/§29).
          return {
            ...parsed.data,
            prediction: { delayMinutes: context.delayMinutes, probability: context.delayProbability },
          };
        }
        console.warn('[GeminiProvider] Model output failed schema validation:', parsed.error.message);
      } catch (err) {
        console.warn(`[GeminiProvider] Call to ${model} failed:`, (err as Error)?.message || err);
      }
    }

    console.warn('[GeminiProvider] All models failed or returned invalid output — falling back to MockProvider.');
    return this.fallback.generateRecommendation(context);
  }
}
