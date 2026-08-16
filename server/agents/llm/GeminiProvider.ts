import { GoogleGenAI } from '@google/genai';
import { LLMProvider, RecommendationContext } from './LLMProvider';
import { StructuredRecommendation, safeParseStructuredRecommendation } from './recommendationSchema';
import { MockProvider } from './MockProvider';
import { requiresApprovalForRisk } from '../../services/PolicyEngine';

const MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-pro'];

function buildPrompt(context: RecommendationContext): string {
  return `
أنت وكيل تحليل تشغيلي لنظام "مَسارَا MASARA" للنقل المدرسي. لديك أرقام تنبؤ ومستوى خطورة محسوبين مسبقاً (وليس من صلاحيتك حسابهما)، ودورك هو الشرح واقتراح إجراء ضمن المخطط المحدد فقط.

بيانات الرحلة:
- المشكلة المرصودة: ${context.problem}
- الحافلة: ${context.busNumber} (السائق: ${context.driverName})
- التأخير المتوقع (دقائق، محسوب مسبقاً): ${context.delayMinutes}
- احتمال التأخير (محسوب مسبقاً): ${context.delayProbability}
- مستوى الخطورة (محسوب مسبقاً، لا تغيّره): ${context.riskLevel}
- وجود حادثة سلامة مفتوحة: ${context.hasSafetyIncident ? 'نعم' : 'لا'}
- مسار بديل متاح: ${context.alternativeRouteId ? `${context.alternativeRouteName} (id: ${context.alternativeRouteId}, تحسين متوقع ${context.alternativeImprovementMins} دقيقة)` : 'لا يوجد'}
- حوادث مفتوحة على الرحلة: ${context.openIncidentDescriptions.length ? context.openIncidentDescriptions.join('؛ ') : 'لا يوجد'}

أعد الاستجابة بصيغة JSON فقط مطابقة تماماً لهذا المخطط (لا تضف حقولاً إضافية):
{
  "type": "DELAY" | "ROUTE_CHANGE" | "SAFETY_ALERT" | "PARENT_NOTIFICATION" | "MONITORING",
  "title": string,
  "problem": string,
  "severity": "low" | "medium" | "high" | "critical",
  "confidence": number,
  "prediction": { "delayMinutes": number, "probability": number },
  "recommendation": {
    "action": "CHANGE_ROUTE" | "NOTIFY_SCHOOL" | "FLAG_INCIDENT" | "NO_ACTION",
    "targetId": string | null,
    "reason": string,
    "expectedOutcome": string | null
  },
  "requiresApproval": boolean
}

يجب أن تكون قيم "delayMinutes" و "probability" و "severity" مطابقة تماماً للقيم المحسوبة مسبقاً أعلاه — أنت تشرح وتبرر فقط، لا تُعِد حسابها ولا تغيّرها.
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
          // The prediction numbers, risk severity, and approval requirement are
          // always overwritten by the engine/governance layer's values — the LLM
          // explains and proposes an action, it never overrides these (spec §9/§29).
          const severity = context.riskLevel;
          return {
            ...parsed.data,
            severity,
            prediction: { delayMinutes: context.delayMinutes, probability: context.delayProbability },
            requiresApproval:
              parsed.data.recommendation.action !== 'NO_ACTION' && requiresApprovalForRisk(severity),
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
