import { LLMProvider, RecommendationContext } from './LLMProvider';
import { StructuredRecommendation } from './recommendationSchema';

// Deterministic, rule-based — no network call, no API key. This is what
// AI_MODE=mock (the default) runs, so the full detect→predict→recommend loop
// works out of the box for every pilot and every demo.
export class MockProvider implements LLMProvider {
  readonly name = 'mock';

  async generateRecommendation(context: RecommendationContext): Promise<StructuredRecommendation> {
    const hasBreakdown = context.openIncidentDescriptions.some((d) => /breakdown|عطل|صيانة/i.test(d));
    const hasFasterRoute =
      !!context.alternativeRouteId && (context.alternativeImprovementMins ?? 0) > 0;

    let action: StructuredRecommendation['recommendation']['action'];
    let targetId: string | null;
    let reason: string;

    if (hasBreakdown) {
      action = 'FLAG_INCIDENT';
      targetId = context.tripId;
      reason = `تم رصد بلاغ صيانة/عطل مرتبط بالرحلة. يوصى بتصعيد الحادثة قبل اتخاذ أي إجراء آخر على المسار.`;
    } else if ((context.riskLevel === 'high' || context.riskLevel === 'medium') && hasFasterRoute) {
      action = 'CHANGE_ROUTE';
      targetId = context.alternativeRouteId ?? null;
      reason = `المسار البديل (${context.alternativeRouteName ?? targetId}) يقلل وقت الوصول المتوقع بمقدار ${context.alternativeImprovementMins} دقيقة مقارنة بالمسار الحالي.`;
    } else if (context.riskLevel === 'high') {
      action = 'NOTIFY_SCHOOL';
      targetId = context.tripId;
      reason = `احتمال التأخير مرتفع (${Math.round(context.delayProbability * 100)}%) ولا يوجد مسار بديل أسرع متاح حالياً، لذا يوصى بإخطار المدرسة وأولياء الأمور استباقياً.`;
    } else {
      action = 'NO_ACTION';
      targetId = null;
      reason = 'الرحلة ضمن الحدود الطبيعية للوقت المستهدف ولا تتطلب أي تدخل حالياً.';
    }

    return {
      problem: context.problem,
      severity: context.riskLevel === 'high' ? 'high' : context.riskLevel === 'medium' ? 'medium' : 'low',
      prediction: {
        delayMinutes: context.delayMinutes,
        probability: context.delayProbability,
      },
      recommendation: { action, targetId, reason },
      requiresApproval: action !== 'NO_ACTION',
    };
  }
}
