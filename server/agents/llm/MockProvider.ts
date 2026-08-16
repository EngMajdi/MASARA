import { LLMProvider, RecommendationContext } from './LLMProvider';
import { StructuredRecommendation } from './recommendationSchema';
import { requiresApprovalForRisk } from '../../services/PolicyEngine';

// Deterministic, rule-based — no network call, no API key. This is what
// AI_MODE=mock (the default) runs, so the full detect→predict→recommend loop
// works out of the box for every pilot, test, and demo (spec Phase 2A §23).
//
// Four deterministic scenarios, driven purely by riskLevel + incident/route
// context:
//   1. Traffic            -> HIGH     -> CHANGE_ROUTE   (faster alternative exists)
//   2. Minor delay        -> MEDIUM   -> NOTIFY_SCHOOL / MONITORING ("watch it")
//   3. No issue           -> LOW      -> NO_ACTION, no approval needed
//   4. Safety event        -> CRITICAL -> FLAG_INCIDENT, mandatory approval
export class MockProvider implements LLMProvider {
  readonly name = 'mock';

  async generateRecommendation(context: RecommendationContext): Promise<StructuredRecommendation> {
    const hasFasterRoute =
      !!context.alternativeRouteId && (context.alternativeImprovementMins ?? 0) > 0;

    let action: StructuredRecommendation['recommendation']['action'];
    let type: StructuredRecommendation['type'];
    let title: string;
    let reason: string;
    let expectedOutcome: string | null;
    let targetId: string | null;
    let confidence: number;

    if (context.riskLevel === 'critical' || context.hasSafetyIncident) {
      action = 'FLAG_INCIDENT';
      type = 'SAFETY_ALERT';
      targetId = context.tripId;
      title = `بلاغ سلامة عاجل — الحافلة ${context.busNumber}`;
      reason = `تم رصد حادثة سلامة على رحلة الحافلة ${context.busNumber} (${context.openIncidentDescriptions.join('؛ ') || 'حادثة غير محددة'}). هذا يتطلب تصعيداً فورياً بصرف النظر عن حالة التأخير.`;
      expectedOutcome = 'تصعيد الحادثة لفريق السلامة والمشرف المباشر للمتابعة الفورية.';
      confidence = 0.95;
    } else if (context.riskLevel === 'high' && hasFasterRoute) {
      action = 'CHANGE_ROUTE';
      type = 'ROUTE_CHANGE';
      targetId = context.alternativeRouteId ?? null;
      title = `تغيير مسار الحافلة ${context.busNumber} إلى ${context.alternativeRouteName}`;
      reason = `المسار البديل (${context.alternativeRouteName ?? targetId}) يقلل وقت الوصول المتوقع بمقدار ${context.alternativeImprovementMins} دقيقة مقارنة بالمسار الحالي.`;
      expectedOutcome = `تقليل التأخير المتوقع بحوالي ${context.alternativeImprovementMins} دقيقة.`;
      confidence = context.delayProbability;
    } else if (context.riskLevel === 'high') {
      action = 'NOTIFY_SCHOOL';
      type = 'PARENT_NOTIFICATION';
      targetId = context.tripId;
      title = `إخطار استباقي — احتمال تأخير مرتفع للحافلة ${context.busNumber}`;
      reason = `احتمال التأخير مرتفع (${Math.round(context.delayProbability * 100)}%) ولا يوجد مسار بديل أسرع متاح حالياً، لذا يوصى بإخطار المدرسة وأولياء الأمور استباقياً.`;
      expectedOutcome = 'طمأنة أولياء الأمور والمدرسة استباقياً بشأن التأخير المتوقع.';
      confidence = context.delayProbability;
    } else if (context.riskLevel === 'medium') {
      action = 'NOTIFY_SCHOOL';
      type = 'MONITORING';
      targetId = context.tripId;
      title = `متابعة تأخير طفيف — الحافلة ${context.busNumber}`;
      reason = `تأخير طفيف محتمل (${Math.round(context.delayProbability * 100)}%) لا يستدعي تغيير المسار حالياً، لكنه يستحق المتابعة.`;
      expectedOutcome = 'متابعة تطور الوضع دون تدخل تشغيلي فوري.';
      confidence = context.delayProbability;
    } else {
      action = 'NO_ACTION';
      type = 'MONITORING';
      targetId = null;
      title = 'لا حاجة لأي إجراء حالياً';
      reason = 'الرحلة ضمن الحدود الطبيعية للوقت المستهدف ولا تتطلب أي تدخل حالياً.';
      expectedOutcome = null;
      confidence = 1 - context.delayProbability;
    }

    const requiresApproval = action !== 'NO_ACTION' && requiresApprovalForRisk(context.riskLevel);

    return {
      type,
      title,
      problem: context.problem,
      severity: context.riskLevel,
      confidence: Number(confidence.toFixed(2)),
      prediction: {
        delayMinutes: context.delayMinutes,
        probability: context.delayProbability,
      },
      recommendation: { action, targetId, reason, expectedOutcome },
      requiresApproval,
    };
  }
}
