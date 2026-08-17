import express from 'express';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import {
  INITIAL_SCHOOLS,
  INITIAL_BUSES,
  INITIAL_STUDENTS,
  INITIAL_ROUTES,
  INITIAL_NOTIFICATIONS,
  INITIAL_WORKFLOW_STEPS
} from './src/mockData';
import { agentRouter } from './server/routes/agentRoutes';
import { simulationRouter } from './server/routes/simulationRoutes';
import { operationsRouter } from './server/routes/operationsRoutes';
import { journeyRouter } from './server/routes/journeyRoutes';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// New governance-layer API (DB-backed: trips/predictions/recommendations/audit log).
// Additive only — does not touch any of the in-memory routes below (Phase 1 scope).
app.use(agentRouter);
// Phase 2B: Simulation Engine + AI Operations Feed — likewise additive.
app.use(simulationRouter);
app.use(operationsRouter);
// Phase 3A: Journey Core — likewise additive.
app.use(journeyRouter);

// In-memory application state
let schools = [...INITIAL_SCHOOLS];
let buses = [...INITIAL_BUSES];
let students = [...INITIAL_STUDENTS];
let routes = [...INITIAL_ROUTES];
let notifications = [...INITIAL_NOTIFICATIONS];
let workflowSteps = [...INITIAL_WORKFLOW_STEPS];

// User accounts in-memory database
let users = [
  { id: 'u-1', name: 'أحمد بن سيف البوسعيدي', email: 'parent@masara.om', password: 'password123', role: 'parent' },
  { id: 'u-2', name: 'الكابتن سعيد بن حمد البوسعيدي', email: 'driver@masara.om', password: 'password123', role: 'driver' },
  { id: 'u-3', name: 'إدارة مدرسة المسار الدولية (مسقط)', email: 'school@masara.om', password: 'password123', role: 'school' },
  { id: 'u-4', name: 'المشرف العام - مركز مسارَا الذكي', email: 'admin@masara.om', password: 'password123', role: 'admin' }
];

// Gemini Client Lazy Initializer
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    console.warn('GEMINI_API_KEY is not set or using default placeholder.');
    return null;
  }
  return new GoogleGenAI({ apiKey });
}

// Helper to call Gemini with model fallbacks and retries on transient errors
async function generateContentWithFallback(ai: GoogleGenAI, params: { contents: any; config?: any }) {
  const models = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-pro'];
  let lastError: any = null;

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: params.contents,
          config: params.config
        });
        if (response && response.text) {
          return response;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`Gemini call attempt ${attempt} for model ${model} failed:`, err?.message || err);
        if (attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }
    }
  }
  throw lastError;
}

// ----------------- API ROUTES ----------------- //

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    system: 'مَسارَا MASARA - AI School Transportation Backend',
    timestamp: new Date().toISOString()
  });
});

// Unified All-Data Endpoint for Live Realtime Synchronization Across Clients
app.get('/api/all-data', (req, res) => {
  res.json({
    schools,
    buses,
    students,
    routes,
    notifications,
    workflowSteps,
    timestamp: new Date().toISOString()
  });
});

// Authentication Login Endpoint
app.post('/api/auth/login', (req, res) => {
  const { email, password, role } = req.body;
  const user = users.find(u => u.email.toLowerCase() === email?.toLowerCase().trim());

  if (!user || user.password !== password) {
    return res.status(401).json({ success: false, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
  }

  const returnUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: role || user.role,
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200'
  };

  res.json({ success: true, user: returnUser });
});

// Authentication Register Endpoint
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, error: 'يرجى تقديم جميع البيانات المطلوبة' });
  }

  const existing = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
  if (existing) {
    return res.status(400).json({ success: false, error: 'هذا البريد الإلكتروني مسجل بالفعل' });
  }

  const newUser = {
    id: `usr-${Date.now()}`,
    name,
    email: email.trim(),
    password,
    role: role || 'parent'
  };

  users.push(newUser);

  res.json({
    success: true,
    user: {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200'
    }
  });
});

app.get('/api/schools', (req, res) => {
  res.json(schools);
});

app.get('/api/buses', (req, res) => {
  res.json(buses);
});

app.get('/api/students', (req, res) => {
  res.json(students);
});

app.get('/api/routes', (req, res) => {
  res.json(routes);
});

app.get('/api/notifications', (req, res) => {
  res.json(notifications);
});

// Add new notification
app.post('/api/notifications', (req, res) => {
  const { title, message, type = 'info', targetRole = 'parent' } = req.body;
  const nowStr = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
  const newNotif = {
    id: `notif-${Date.now()}`,
    timestamp: nowStr,
    title: title || 'تنبيه مسارَا الذكي',
    message: message || '',
    type: type as any,
    targetRole: targetRole as any,
    read: false
  };
  notifications.unshift(newNotif);
  res.json({ success: true, notification: newNotif, notifications });
});

// Schedule/Trigger 5-minute pre-arrival notification for parents
app.post('/api/notifications/schedule-prearrival', (req, res) => {
  const { studentId, busId, minutesBefore = 5 } = req.body;
  const student = students.find((s) => s.id === studentId);
  const bus = buses.find((b) => b.id === busId || b.id === student?.busId);

  const nowStr = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
  const stdName = student ? student.name : 'الطالب';
  const busNum = bus ? bus.busNumber : 'الحافلة';
  const pickupPointName = student?.pickupPoint?.nameAr || 'نقطة التجمع';
  const etaMins = bus ? bus.nextStopEtaMins : minutesBefore;

  const newNotif = {
    id: `notif-prearrival-${Date.now()}`,
    timestamp: nowStr,
    title: `⏰ تنبيه مبكر: الحافلة تبعد ${minutesBefore} دقائق عن نقطة التجمع!`,
    message: `تنبيه أوتوماتيكي: الحافلة (${busNum}) على وشك الوصول إلى نقطة التوقف (${pickupPointName}) للطالب (${stdName}) خلال ${minutesBefore} دقائق (ETA الحالي: ${etaMins} دقائق). يرجى التجهز للركوب!`,
    type: 'alert' as const,
    targetRole: 'parent' as const,
    read: false
  };

  notifications.unshift(newNotif);

  res.json({
    success: true,
    scheduledMinutes: minutesBefore,
    busEtaMins: etaMins,
    notification: newNotif,
    notifications
  });
});

app.get('/api/workflow-steps', (req, res) => {
  res.json(workflowSteps);
});

// Create new student
app.post('/api/students', (req, res) => {
  const newStudent = { id: `std-${Date.now()}`, ...req.body };
  students.unshift(newStudent);
  res.json({ success: true, student: newStudent, students });
});

// Delete student
app.delete('/api/students/:id', (req, res) => {
  const { id } = req.params;
  const idx = students.findIndex((s) => s.id === id);
  if (idx !== -1) students.splice(idx, 1);
  res.json({ success: true, students });
});

// Create new bus
app.post('/api/buses', (req, res) => {
  const newBus = { id: `bus-${Date.now()}`, ...req.body };
  buses.unshift(newBus);
  res.json({ success: true, bus: newBus, buses });
});

// Delete bus
app.delete('/api/buses/:id', (req, res) => {
  const { id } = req.params;
  const idx = buses.findIndex((b) => b.id === id);
  if (idx !== -1) buses.splice(idx, 1);
  res.json({ success: true, buses });
});

// Create new route
app.post('/api/routes', (req, res) => {
  const newRoute = { id: `route-${Date.now()}`, ...req.body };
  routes.unshift(newRoute);
  res.json({ success: true, route: newRoute, routes });
});

// Delete route
app.delete('/api/routes/:id', (req, res) => {
  const { id } = req.params;
  const idx = routes.findIndex((r) => r.id === id);
  if (idx !== -1) routes.splice(idx, 1);
  res.json({ success: true, routes });
});

// Start Route Endpoint
app.post('/api/buses/:id/start-route', (req, res) => {
  const { id } = req.params;
  const targetBus = buses.find((b) => b.id === id);
  if (targetBus) {
    targetBus.status = 'en_route_pickup';
  }

  const targetRoute = routes.find((r) => r.busId === id);
  if (targetRoute) {
    targetRoute.status = 'active';
  }

  const nowStr = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
  const newNotif = {
    id: `notif-${Date.now()}`,
    timestamp: nowStr,
    title: `انطلاق المسار المباشر (حافلة ${targetBus?.busNumber || id})`,
    message: `أكد السائق (${targetBus?.driverName || 'الكابتن'}) بدء الرحلة رسمياً للمسار (${targetRoute?.routeNameAr || 'المسار'}). تم تحديث حالة "Route Started" في لوحة التحكم الإدارية وبدء التتبع عبر الرادار.`,
    type: 'success' as const,
    targetRole: 'all' as const,
    read: false
  };

  notifications.unshift(newNotif);

  res.json({
    success: true,
    bus: targetBus,
    route: targetRoute,
    notifications
  });
});

// Update Student Boarding / Absence Status
app.post('/api/students/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const student = students.find((s) => s.id === id);
  if (!student) {
    return res.status(404).json({ error: 'الطالب غير موجود' });
  }

  student.status = status;
  if (status === 'boarded') {
    const nowStr = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    student.pickupTimeActual = nowStr;

    // Dispatch notification
    const newNotif = {
      id: `notif-${Date.now()}`,
      timestamp: nowStr,
      title: `تأكيد صعود الطالب (${student.name})`,
      message: `تم صعود الطالب ${student.name} إلى ${student.busNumber} بنجاح عند المقعد ${student.seatNumber}.`,
      type: 'success' as const,
      targetRole: 'parent' as const,
      read: false
    };
    notifications.unshift(newNotif);
  } else if (status === 'absent') {
    const nowStr = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    const newNotif = {
      id: `notif-${Date.now()}`,
      timestamp: nowStr,
      title: `تسجيل غياب الطالب (${student.name})`,
      message: `تم إبلاغ السائق وإعادة احتساب محطة التوقف في المسار التلقائي.`,
      type: 'warning' as const,
      targetRole: 'driver' as const,
      read: false
    };
    notifications.unshift(newNotif);
  }

  res.json({ success: true, student, notifications });
});

// 1. AI Route Optimizer Endpoint (Gemini Powered)
app.post('/api/ai/optimize-routes', async (req, res) => {
  try {
    const ai = getGeminiClient();
    const { schoolId, trafficCondition } = req.body;

    const schoolObj = schools.find((s) => s.id === schoolId) || schools[0];
    const schoolStudents = students.filter((s) => s.schoolId === schoolObj.id);

    const prompt = `
أنت وكيل الذكاء الاصطناعي الخاص بنظام "مَسارَا MASARA" المخصص لإدارة وحوكمة النقل المدرسي.
قم بتحليل بيانات المدرسة والطلبة التالية واقترح تحسيناً للمسارات:

المدرسة: ${schoolObj.nameAr}
الموقع: Lat ${schoolObj.location.lat}, Lng ${schoolObj.location.lng}
عدد الطلاب المقيدين: ${schoolStudents.length}
حالة المرور الحالية: ${trafficCondition || 'ازدحام متوسط في الطرق الرئيسية'}

الطلبة ونقاط التوقف الحالية:
${schoolStudents
  .map(
    (s) => `- ${s.name} (الصف: ${s.grade}) | الموقع: ${s.pickupPoint.nameAr} (${s.pickupPoint.address})`
  )
  .join('\n')}

المطلوب:
قم بصياغة استجابة JSON دقيقة تحتوي على المفاتيح التالية باللغة العربية:
1. "summaryAr": ملخص تنفيذي احترافي باللغة العربية يوضح كيف قام الذكاء الاصطناعي بتجميع الطلاب وتخفيض زمن الرحلة وتفادي الاختناقات المرورية.
2. "efficiencyGain": نسبة مئوية متوقعة للزيادة في الكفاءة (مثال: 24).
3. "timeSavedMins": عدد الدقائق الموفرة (مثال: 14).
4. "fuelSavedLiters": لترات الوقود الموفرة (مثال: 5.2).
5. "recommendations": مصفوفة نصوص من 3 توجيهات أمان واقتراحات للسائق ولأولياء الأمور.
    `;

    let resultJson = {
      summaryAr: 'تم تجميع نقاط التوقف القريبة في حي القرم والعذيبة بمسقط لإلغاء 3 توقفات فردية مسببة للتأخير، مما قلل زمن الانتظار الإجمالي ووفر 18% من استهلاك الوقود.',
      efficiencyGain: 28,
      timeSavedMins: 16,
      fuelSavedLiters: 6.4,
      recommendations: [
        'دمج نقطة القرم أ وب لتوفير 4 دقائق من وقت الالتفاف.',
        'توجيه حافلة 101 عبر طريق مسقط السريع لتفادي ازدحام شارع السلطان قابوس.',
        'إرسال إشعار استباقي لأولياء الأمور قبل الوصول بـ 5 دقائق لتجنب تأخر ركوب الطلبة.'
      ]
    };

    if (ai) {
      try {
        const response = await generateContentWithFallback(ai, {
          contents: prompt,
          config: {
            responseMimeType: 'application/json'
          }
        });

        if (response.text) {
          const parsed = JSON.parse(response.text);
          resultJson = { ...resultJson, ...parsed };
        }
      } catch (geminiError) {
        console.warn('Gemini API call error (using fallback):', geminiError);
      }
    }

    // Analysis-only (Phase 2B governance fix): this endpoint used to write
    // aiEfficiencyScore/carbonSavedKg/aiRationaleAr directly onto `routes`
    // straight from an LLM response, with no policy check, no approval, no
    // audit trail. It now only returns the AI's analysis; nothing here
    // mutates operational route state. Applying a real route change goes
    // through the governed path: MasaraOperationsAgent -> PolicyEngine ->
    // Approval Center -> ActionExecutor (see server/routes/agentRoutes.ts).
    const newNotif = {
      id: `notif-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
      title: 'تحليل ذكي جديد لتحسين المسارات (MASARA AI)',
      message: `${resultJson.summaryAr} — هذا تحليل استرشادي، ولم يُطبَّق تلقائياً على المسارات.`,
      type: 'info' as const,
      targetRole: 'all' as const,
      read: false
    };
    notifications.unshift(newNotif);

    res.json({
      success: true,
      result: resultJson,
      routes,
      notifications
    });
  } catch (error) {
    console.error('Error optimizing routes:', error);
    res.status(500).json({ error: 'حدث خطأ أثناء معالجة خوارزمية الذكاء الاصطناعي' });
  }
});

// 2. AI Traffic Reroute Simulator Endpoint
app.post('/api/ai/detect-reroute', async (req, res) => {
  try {
    const ai = getGeminiClient();
    const { busId, incidentDescription } = req.body;

    const targetBus = buses.find((b) => b.id === busId) || buses[0];
    const incident = incidentDescription || 'ازدحام مفاجئ بسبب أعمال صيانة على شارع السلطان قابوس';

    const prompt = `
أنت نظام الملاحة الذكي والإنذار المبكر في "مَسارَا MASARA" بسلطنة عمان.
حدث تغيير طارئ في الطريق: "${incident}".
الحافلة المستهدفة: ${targetBus.busNumber} (السائق: ${targetBus.driverName}).

قم بصياغة حل إعادة توجيه (Rerouting) فوري باللغة العربية بصيغة JSON تحتوي على:
1. "rerouteTitleAr": عنوان التوجيه البديل.
2. "actionPlanAr": شرح خطة إعادة التوجيه خطوة بخطوة وتفادي العائق.
3. "newEtaMins": الوقت المتوقع الجديد بالدقائق (مثال: 5).
4. "parentAlertMessage": نص التنبيه الموجّه لأولياء الأمور لطمأنتهم وإفادتهم بالمسار البديل.
    `;

    let rerouteData = {
      rerouteTitleAr: 'إعادة توجيه ديناميكية - مسار بديل عبر طريق مسقط السريع',
      actionPlanAr: `كشف وكيل مسارَا إعاقة مرورية (${incident}). تم تحويل الحافلة فوراً إلى طريق مسقط السريع لتفادي التأخير لمدة 12 دقيقة.`,
      newEtaMins: 6,
      parentAlertMessage: `نحيطكم علماً بأن وكيل مسارَا قام بتعديل مسار حافلة ${targetBus.busNumber} تلقائياً لتفادي ازدحام مفاجئ. الوصول المتوقع خلال 6 دقائق.`
    };

    if (ai) {
      try {
        const response = await generateContentWithFallback(ai, {
          contents: prompt,
          config: {
            responseMimeType: 'application/json'
          }
        });

        if (response.text) {
          const parsed = JSON.parse(response.text);
          rerouteData = { ...rerouteData, ...parsed };
        }
      } catch (err) {
        console.warn('Gemini reroute error (fallback used):', err);
      }
    }

    // Analysis-only (Phase 2B governance fix): this endpoint used to write
    // nextStopEtaMins/status directly onto the target bus straight from an
    // LLM response, with no policy check, no approval, no audit trail. It
    // now only returns the AI's suggested reroute plan; nothing here mutates
    // bus/trip state. Applying a real reroute goes through the governed
    // path: MasaraOperationsAgent -> PolicyEngine -> Approval Center ->
    // ActionExecutor (see server/routes/agentRoutes.ts).
    const newNotif = {
      id: `notif-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
      title: `اقتراح إعادة توجيه: ${rerouteData.rerouteTitleAr}`,
      message: `${rerouteData.parentAlertMessage} — هذا اقتراح استرشادي بانتظار مراجعة المشرف، ولم يُطبَّق تلقائياً.`,
      type: 'alert' as const,
      targetRole: 'all' as const,
      read: false
    };
    notifications.unshift(newNotif);

    res.json({
      success: true,
      rerouteData,
      bus: targetBus,
      notifications
    });
  } catch (error) {
    console.error('Error in reroute endpoint:', error);
    res.status(500).json({ error: 'فشل في إعادة التوجيه الذكي' });
  }
});

// 2.5. AI Traffic-Based Bus ETA Prediction Endpoint (MASARA AI Predictive Engine)
app.post('/api/ai/predict-traffic-eta', async (req, res) => {
  try {
    const ai = getGeminiClient();
    const { trafficLevel, selectedBusId } = req.body;

    const level = trafficLevel || 'heavy'; // 'smooth' | 'moderate' | 'heavy' | 'accident'
    const targetBuses = selectedBusId
      ? buses.filter((b) => b.id === selectedBusId)
      : buses;

    const trafficDescriptions: Record<string, string> = {
      smooth: 'انسيابية كاملة وحركة مرور طبيعية على كافة المحاور بمسقط',
      moderate: 'بطء خفيف وازدحام متوسط بالقرب من الإشارات والدوارات الرئيسية',
      heavy: 'اختناق مروري كثيف وتوقف حركة السير على شارع السلطان قابوس والدائري',
      accident: 'حادث مروري وأعمال صيانة طارئة تسبب شللاً جزئياً في الحركة'
    };

    const currentTrafficDesc = trafficDescriptions[level] || trafficDescriptions.heavy;

    const prompt = `
أنت خوارزمية التنبؤ الذكي بالوقت والمتغيرات المرورية لنظام "مَسارَا MASARA" للنقل المدرسي بسلطنة عمان.
حالة الازدحام المروري الحالية المسجلة بالرادار: "${currentTrafficDesc}".

أسطول الحافلات المراد التحليل والتنبؤ لها:
${targetBuses
  .map(
    (b) =>
      `- الحافلة: ${b.busNumber} (السائق: ${b.driverName}) | السرعة الحالية: ${b.speedKmH} كم/س | المحطة القادمة: ${b.nextStopName} | ETA الأولي: ${b.nextStopEtaMins} دقيقة`
  )
  .join('\n')}

المطلوب: قم بتحليل تأثير حالة الازدحام هذه وصياغة استجابة JSON دقيقة باللغة العربية تحتوي على:
1. "trafficConditionSummaryAr": وصف تحليلي احترافي لحالة الطرق وتأثيرها على رحلات الحافلات.
2. "overallTrafficIndex": مؤشر الازدحام الإجمالي المئوي (مثال: 78).
3. "predictions": مصفوفة كائنات لكل حافلة تحتوي على المفاتيح:
   - "busId": معرف الحافلة (مثال: "${targetBuses[0]?.id || 'bus-101'}").
   - "busNumber": رقم الحافلة.
   - "originalEtaMins": الوقت الأصلي التقديري بالدقائق.
   - "predictedEtaMins": الوقت التقديري المعدل بعد تقييم الازدحام بالدقائق.
   - "delayMins": مقدار التأخير الإضافي المتوقع بالدقائق.
   - "congestionPercent": نسبة الكثافة المرورية بالمسار (مثال: 82).
   - "aiAlternativeRoute": اقتراح مسار بديل باللغة العربية أو توصية للمشرف (مثال: "سلوك شارع المشتل بدلاً من الدوار الرئيسي").
   - "confidenceScore": نسبة ثقة النموذج من 100 (مثال: 97).
   - "statusBadge": شارة حالة مناسبة مثل ("تأخير خفيف", "مسار سلس", "تأخير متوسط", "تحويل اضطراري").
    `;

    let fallbackPredictions = targetBuses.map((b) => {
      let multiplier = 1.0;
      let delay = 0;
      let badge = 'مسار سلس';
      let routeOffer = 'المسار الحالي ممتاز ولا يتطلب تغييرات';

      if (level === 'moderate') {
        multiplier = 1.35;
        delay = Math.ceil(b.nextStopEtaMins * 0.35);
        badge = 'تأخير طفيف';
        routeOffer = 'الاستمرار في المسار الحالي مع تقليل السرعة عند الدوار';
      } else if (level === 'heavy') {
        multiplier = 1.85;
        delay = Math.ceil(b.nextStopEtaMins * 0.85);
        badge = 'تأخير متوسط';
        routeOffer = 'تحويل الحركة إلى طريق مسقط السريع بدلاً من الشارع العام';
      } else if (level === 'accident') {
        multiplier = 2.4;
        delay = Math.ceil(b.nextStopEtaMins * 1.4);
        badge = 'تحويل اضطراري';
        routeOffer = 'سلوك الطرق الفرعية داخل الحي لتفادي منطقة الحادث';
      }

      const predictedEta = Math.round(b.nextStopEtaMins * multiplier);

      return {
        busId: b.id,
        busNumber: b.busNumber,
        originalEtaMins: b.nextStopEtaMins,
        predictedEtaMins: predictedEta,
        delayMins: delay,
        congestionPercent: level === 'smooth' ? 18 : level === 'moderate' ? 48 : level === 'heavy' ? 82 : 94,
        aiAlternativeRoute: routeOffer,
        confidenceScore: 96,
        statusBadge: badge
      };
    });

    let predictionResult = {
      trafficConditionSummaryAr: `تم تحليل كفاءة حركة المرور في مسقط. حالة الطرق: (${currentTrafficDesc}). تم تحديث أوقات الوصول المتوقعة (ETA) لجميع الحافلات بدقة عالية.`,
      overallTrafficIndex: level === 'smooth' ? 20 : level === 'moderate' ? 52 : level === 'heavy' ? 82 : 95,
      predictions: fallbackPredictions
    };

    if (ai) {
      try {
        const response = await generateContentWithFallback(ai, {
          contents: prompt,
          config: {
            responseMimeType: 'application/json'
          }
        });

        if (response.text) {
          const parsed = JSON.parse(response.text);
          if (parsed && Array.isArray(parsed.predictions)) {
            predictionResult = { ...predictionResult, ...parsed };
          }
        }
      } catch (geminiError) {
        console.warn('Gemini Traffic ETA prediction error (fallback used):', geminiError);
      }
    }

    // Analysis-only (Phase 2B governance fix): this endpoint used to write
    // predictedEtaMins directly onto every matching bus straight from an
    // LLM/heuristic response, with no policy check, no approval, no audit
    // trail. It now only returns the predicted ETAs; nothing here mutates
    // bus state. A real ETA-driven action goes through the governed path:
    // MasaraOperationsAgent -> PredictionEngine -> PolicyEngine -> Approval
    // Center -> ActionExecutor (see server/routes/agentRoutes.ts).
    const notifTitle = `تحليل توقعات ETA الذكية - ${
      level === 'smooth' ? 'مرور سلس' : level === 'moderate' ? 'ازدحام متوسط' : 'ازدحام مروري كثيف'
    }`;
    const newNotif = {
      id: `notif-eta-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
      title: notifTitle,
      message: `${predictionResult.trafficConditionSummaryAr} — تحليل استرشادي، لم يُطبَّق تلقائياً على الحافلات.`,
      type: (level === 'smooth' ? 'success' : level === 'moderate' ? 'info' : 'warning') as any,
      targetRole: 'all' as const,
      read: false
    };
    notifications.unshift(newNotif);

    res.json({
      success: true,
      predictionResult,
      buses,
      notifications
    });
  } catch (error) {
    console.error('Error predicting traffic ETA:', error);
    res.status(500).json({ error: 'حدث خطأ في محرك التنبؤ المروري الذكي' });
  }
});

// Helper to construct local fallback response when Gemini API is offline/failing
function generateLocalAdvisorAnswer(
  query: string,
  userRole: string,
  busesData: typeof buses,
  studentsData: typeof students,
  schoolsData: typeof schools,
  routesData: typeof routes
): string {
  const q = (query || '').toLowerCase().trim();

  // 1. Search for specific student queries (e.g., مريم, الخليل, سالم, ريم, ابني, ابنتي)
  const matchedStudents = studentsData.filter((s) => {
    const stdName = s.name.toLowerCase();
    const parentName = (s.parentName || '').toLowerCase();
    const queryWords = q.split(/\s+/).filter((w) => w.length > 2);
    return (
      (q.includes('ابن') || q.includes('ابنتم') || q.includes('طالب') || q.includes('ولدي') || q.includes('بنتي') || q.includes('حالة') || q.includes('اين') || q.includes('أين') || q.includes('صعد') || q.includes('ركب')) &&
      (queryWords.some((w) => stdName.includes(w) || parentName.includes(w)) ||
        q.includes('مريم') || q.includes('الخليل') || q.includes('سالم') || q.includes('ريم'))
    );
  });

  if (matchedStudents.length > 0) {
    let result = `🔍 **بيانات واستعلام الطلاب المعنيين (${matchedStudents.length}):**\n\n`;
    matchedStudents.forEach((std) => {
      const bus = busesData.find((b) => b.id === std.busId || b.busNumber === std.busNumber) || busesData[0];
      const statusText =
        std.status === 'boarded'
          ? `تم الصعود للحافلة بنجاح ✅ (سجل وقت الصعود الفعلي: ${std.pickupTimeActual || std.pickupTimePlanned})`
          : std.status === 'waiting'
          ? `في انتظار وصول الحافلة ⏳ (وقت التجمع المخطط: ${std.pickupTimePlanned})`
          : `غائب عن الرحلة اليوم ❌`;

      result += `👦 **الطالب:** ${std.name} (${std.grade})\n`;
      result += `🏫 **المدرسة:** ${std.schoolName}\n`;
      result += `🪑 **رقم المقعد المخصص:** ${std.seatNumber} | 📌 **نقطة الركوب:** ${std.pickupPoint?.nameAr || 'نقطة الحي'}\n`;
      result += `📊 **حالة الحضور:** ${statusText}\n`;
      result += `🚌 **الحافلة المخصصة:** ${std.busNumber} (${bus?.plateNumber || ''})\n`;
      result += `👤 **سائق الحافلة:** ${bus?.driverName || 'الكابتن سعيد البوسعيدي'}\n`;
      result += `📞 **هاتف السائق للتواصل المباشر:** ${bus?.driverPhone || '+968 9123 4567'}\n`;
      if (bus) {
        result += `📍 **المحطة القادمة للحافلة:** "${bus.nextStopName}" (سرعة الحافلة: ${bus.speedKmH} كم/س)\n`;
        result += `⏱️ **الوقت المتبقي المحدد للوصول (ETA):** ${bus.nextStopEtaMins} دقائق\n`;
      }
      result += `\n-----------------------------------\n\n`;
    });
    return result;
  }

  // 2. Search for bus / ETA / location queries (e.g. أين الباص، كم الوقت، 101، 102، وصول، السائق)
  const isBusQuery =
    q.includes('باص') ||
    q.includes('حافلة') ||
    q.includes('101') ||
    q.includes('102') ||
    q.includes('103') ||
    q.includes('أين') ||
    q.includes('اين') ||
    q.includes('وصل') ||
    q.includes('وصول') ||
    q.includes('وقت') ||
    q.includes('موقع') ||
    q.includes('سرعة') ||
    q.includes('كم');

  if (isBusQuery) {
    let targetBuses = busesData;
    if (q.includes('101')) targetBuses = busesData.filter((b) => b.busNumber.includes('101'));
    else if (q.includes('102')) targetBuses = busesData.filter((b) => b.busNumber.includes('102'));
    else if (q.includes('103')) targetBuses = busesData.filter((b) => b.busNumber.includes('103'));

    let result = `🚌 **تقرير الملاحة المباشرة والوقت المحدد للوصول (GPS & ETA Radar):**\n\n`;
    targetBuses.forEach((b) => {
      result += `🚏 **${b.busNumber}** (رقم اللوحة: ${b.plateNumber})\n`;
      result += `👤 **السائق المسؤول:** ${b.driverName}\n`;
      result += `📞 **هاتف السائق:** ${b.driverPhone}\n`;
      result += `🚦 **مسار الحافلة الحالي:** ${
        b.status === 'en_route_school'
          ? 'تتجه نحو المدرسة 🏫'
          : b.status === 'en_route_pickup'
          ? 'في مسار نقل وتجميع الطلاب من المنازل 🚏'
          : 'متوقفة في مركز الخدمة 🅿️'
      }\n`;
      result += `📍 **المحطة القادمة:** ${b.nextStopName}\n`;
      result += `⏱️ **الوقت المحدد المتبقي للوصول (ETA):** ${b.nextStopEtaMins} دقائق\n`;
      result += `🚀 **السرعة الحالية:** ${b.speedKmH} كم/س | 👥 **الحمولة:** ${b.currentOccupancy} من أصل ${b.capacity} طالب\n`;
      result += `🛡️ **مؤشر أمان وسلامة الحافلة:** ${b.safetyScore}%\n`;
      result += `\n-----------------------------------\n\n`;
    });
    return result;
  }

  // 3. Search for driver info / contact queries
  if (q.includes('سائق') || q.includes('هاتف') || q.includes('تواصل') || q.includes('رقم') || q.includes('اتصال')) {
    let result = `📞 **دليل أرقام التواصل الفوري مع سائقي الحافلات المدرسية:**\n\n`;
    busesData.forEach((b) => {
      result += `🚌 **${b.busNumber}** (${b.plateNumber})\n`;
      result += `👤 **السائق:** ${b.driverName}\n`;
      result += `📱 **رقم الجوال المباشر:** ${b.driverPhone}\n`;
      result += `📍 **المحطة القادمة:** ${b.nextStopName} (ETA: ${b.nextStopEtaMins} دقائق)\n\n`;
    });
    return result;
  }

  // 4. Default rich overview
  return `أهلاً بك في **مساعد مَسارَا الذكي (MASARA AI Assistant)** 🚌✨

أنا متصل مباشرة بقاعدة بيانات الأسطول والتتبع المباشر بمسقط. إليك ملخص البيانات اللحظية:

📍 **تحديثات أسطول الحافلات المباشرة:**
• **حافلة 101:** بقيادة ${busesData[0]?.driverName || 'الكابتن سعيد البوسعيدي'} (📞 ${busesData[0]?.driverPhone}) | تتجه إلى "${busesData[0]?.nextStopName}" | الوصول خلال: **${busesData[0]?.nextStopEtaMins} دقائق**
• **حافلة 102:** بقيادة ${busesData[1]?.driverName || 'الكابتن سالم المعمري'} (📞 ${busesData[1]?.driverPhone}) | تتجه إلى "${busesData[1]?.nextStopName}" | الوصول خلال: **${busesData[1]?.nextStopEtaMins} دقائق**

👦 **حالة صعود وحضور الطلاب اليوم:**
• إجمالي الطلاب المسجلين: ${studentsData.length} طلاب
• تم الصعود بنجاح: ${studentsData.filter((s) => s.status === 'boarded').length} طلاب ✅
• في انتظار الحافلة: ${studentsData.filter((s) => s.status === 'waiting').length} طلاب ⏳

💬 **يمكنك كتابة أي سؤال مباشر مثل:**
- "أين حافلة 101 ومتى تصل محطتها القادمة؟"
- "هل صعد الطالب الخليل البوسعيدي إلى الحافلة؟"
- "ما هو رقم هاتف سائق الحافلة؟"`;
}

// 3. AI Smart Advisor Endpoint (Q&A for Masara)
app.post('/api/ai/ask-advisor', async (req, res) => {
  try {
    const ai = getGeminiClient();
    const { query, userRole, currentBuses, currentStudents, currentSchools, currentRoutes } = req.body;

    const busesData = currentBuses && Array.isArray(currentBuses) && currentBuses.length > 0 ? currentBuses : buses;
    const studentsData = currentStudents && Array.isArray(currentStudents) && currentStudents.length > 0 ? currentStudents : students;
    const schoolsData = currentSchools && Array.isArray(currentSchools) && currentSchools.length > 0 ? currentSchools : schools;
    const routesData = currentRoutes && Array.isArray(currentRoutes) && currentRoutes.length > 0 ? currentRoutes : routes;

    const liveContext = `
بيانات منصة مَسارَا الحية الحالية (LIVE DATABASE CONTEXT):

1. قائمة الحافلات وسائقيها ومواقعها وأوقات الوصول المتوقعة (LIVE BUSES):
${JSON.stringify(busesData, null, 2)}

2. قائمة الطلاب وحالة حضورهم ومقاعدهم وأولياء أمورهم (LIVE STUDENTS):
${JSON.stringify(studentsData, null, 2)}

3. قائمة المدارس المسجلة (LIVE SCHOOLS):
${JSON.stringify(schoolsData, null, 2)}

4. المسارات الحية (LIVE ROUTES):
${JSON.stringify(routesData, null, 2)}
`;

    const systemPrompt = `
أنت "المساعد والوكيل الذكي المساعد لمنظومة مَسارَا الذكية للنقل المدرسي بمسقط سلطنة عمان (MASARA AI Assistant)".
دورك هو الإجابة الشاملة والدقيقة والاحترافية باللغة العربية على أي سؤال أو استفسار يطرحه المستخدم (دور المستخدم: ${userRole || 'ولي أمر'}).

السياق الحي لقاعدة البيانات الحالية في النظام:
${liveContext}

تعليمات هامة جداً للإجابة:
1. أنت متصل مباشرة بقاعدة البيانات الحية المعروضة أعلاه ولديك معلومات كاملة ودقيقة عن كل طالب، كل حافلة، كل سائق، كل موقع GPS، وكل وقت وصول متوقع (ETA).
2. إذا سأل المستخدم عن "أين الباص؟"، أو "متى يصل؟"، أو "الوقت المحدد للوصول؟"، ابحث في قائمة الحافلات أعلاه واذكر رقم الحافلة، اسم السائق، رقم جواله، سرعة الحافلة، المحطة القادمة، والوقت المحدد للوصول بالدقائق (ETA).
3. إذا سأل ولي الأمر عن ابنه/ابنته أو طالب معين (مثل مريم، الخليل، سالم، ريم، الخ)، ابحث عن اسم الطالب واذكر فوراً: اسم الطالب الكامل، الصف، المدرسة، حالة الحضور (تم الصعود ✅ / ينتظر ⏳ / غائب ❌)، رقم المقعد، رقم الحافلة، اسم السائق ورقم جواله، والوقت المتوقع لوصول الحافلة لموقعه.
4. إذا سأل عن أرقام هواتف السائقين أو التواصل مع إدارة المدرسة، أعطه أرقام الهواتف وأسماء الكباتن المباشرة من البيانات.
5. أجب بأسلوب منظم وواضح جداً مع استخدام النقاط والأيقونات التعبيرية (مثل 🚌, ⏱️, 📍, ✅, 📞, 👦).
6. السؤال المطروح من المستخدم: "${query || 'أين الباص ومتى يصل وما هي تفاصيل الطلاب؟'}"
`;

    let answerText = generateLocalAdvisorAnswer(query, userRole || 'parent', busesData, studentsData, schoolsData, routesData);

    if (ai) {
      try {
        const response = await generateContentWithFallback(ai, {
          contents: systemPrompt
        });
        if (response.text) {
          answerText = response.text;
        }
      } catch (geminiError) {
        console.warn('Gemini Advisor Error (fallback used):', geminiError);
      }
    }

    res.json({ answer: answerText });
  } catch (err) {
    console.error('Advisor endpoint error:', err);
    res.status(500).json({ error: 'فشل المساعد الذكي' });
  }
});

// 4. Specialized Multi-Agent Executor Endpoint
app.post('/api/ai/run-agent', async (req, res) => {
  try {
    const ai = getGeminiClient();
    const { agentType, customInput } = req.body;

    let agentTitle = '';
    let prompt = '';

    if (agentType === 'safety') {
      agentTitle = 'وكيل سلامة الحضور ومتابعة الصعود';
      prompt = `
أنت "وكيل سلامة الطلاب" الخاص بنظام مسارَا MASARA للنقل المدرسي.
قم بتحليل بيانات الطلاب المقيدين والحافلات والغياب الحالي، وصياغة خطة عمل وتقارير سلامة سريعة باللغة العربية بصيغة JSON تحتوي على:
1. "agentStatus": حالة وكيل السلامة (مثال: "تم الفحص والتحقق الكامل بنسبة 100%").
2. "checkedStudentsCount": عدد الطلاب المفحوصين (${students.length}).
3. "findings": مصفوفة من 3 نقاط توضح الملاحظات الأمنية وحالة الصعود.
4. "actionNotice": إجراء أو تنبيه فوري يُرسل لأولياء الأمور والمشرفين.
5. "riskScore": تقييم مستوى المخاطر من 100 (مثال: 98/100 أمان ممتاز).
      `;
    } else if (agentType === 'maintenance') {
      agentTitle = 'وكيل الصيانة الاستباقية للأسطول';
      prompt = `
أنت "وكيل الصيانة والإنذار المبكر للمركبات" في مسارَا MASARA بسلطنة عمان.
بيانات أسطول الحافلات الحالي:
${buses.map(b => `- ${b.busNumber} (${b.plateNumber}): السائق ${b.driverName}، السعة ${b.capacity}، استهلاك الوقود 100%`).join('\n')}

المطلوب: قم بتحليل البيانات وإعطاء تقرير صيانة دوري باللغة العربية بصيغة JSON تحتوي على:
1. "fleetHealthScore": نسبة جاهزية الأسطول (مثال: 96%).
2. "criticalAlerts": مصفوفة من الحافلات التي تتطلب فحص دوري أو تغيير زيت/إطارات.
3. "recommendedActions": 3 خطوات صيانة وقائية مقترحة.
4. "estimatedSavingsOMR": التوفير المالي المتوقع بالريال العماني (OMR) جراء الصيانة الوقائية قبل التعطل.
      `;
    } else {
      agentTitle = 'وكيل التحسين والتخطيط الأوتوماتيكي';
      prompt = `
أنت "وكيل التخطيط الذكي" بنظام مسارَا MASARA بسلطنة عمان.
مدخل إضافي: "${customInput || 'مراجعة كافة مسارات الحافلات بمسقط والولايات المجاورة'}".
قم بصياغة تقرير تشغيلي متكامل بصيغة JSON يحتوي على:
1. "summaryAr": ملخص الخطة التكتيكية.
2. "actionSteps": مصفوفة من 3 خطوات تنفيدية.
3. "impactScore": نسبة التأثير إيجابياً.
      `;
    }

    let agentResult: any = {
      agentTitle,
      agentStatus: 'تم التشغيل والتحليل التلقائي بنجاح ⚡',
      checkedStudentsCount: students.length,
      findings: [
        'تأكيد مطابقة ركوب 100% من الطلاب المسجلين بالرحلة الصباحية.',
        'عدم وجود أي طالب متأخر أو مفقود عند نقاط التجميع.',
        'تطبيق التنبيهات المباشرة لجميع أولياء الأمور قبل الوصول بـ 3 دقائق.'
      ],
      actionNotice: 'تنسيق آلي مع مشرفة المدرسة لاستقبال الطالبين عند البوابة الشرقية.',
      riskScore: 99,
      fleetHealthScore: '97%',
      criticalAlerts: ['حافلة 102 - يفضل فحص ضغط الإطارات والمكيف قبل رحلة العودة.'],
      recommendedActions: [
        'جدولة صيانة دورية للحافلة 102 بعد نهاية الدوام.',
        'إعادة ضبط حساسات الحزام التلقائية للحافلة 101.',
        'فحص فلتر الوقود لضمان الاستدامة وتخفيض الانبعاثات.'
      ],
      estimatedSavingsOMR: 150,
      summaryAr: 'تم تنفيذ المسح التكتيكي الشامل وتحسين الخطة التشغيلية لجميع الحافلات في محافظة مسقط.',
      actionSteps: ['إعادة توزيع المقاعد', 'تحديث خطة الطوارئ', 'إخطار السائقين بالمسار الجديد']
    };

    if (ai) {
      try {
        const response = await generateContentWithFallback(ai, {
          contents: prompt,
          config: {
            responseMimeType: 'application/json'
          }
        });

        if (response.text) {
          const parsed = JSON.parse(response.text);
          agentResult = { ...agentResult, ...parsed };
        }
      } catch (err) {
        console.warn('Run Agent Gemini Error (fallback used):', err);
      }
    }

    res.json({ success: true, agentResult });
  } catch (err) {
    console.error('Run Agent endpoint error:', err);
    res.status(500).json({ error: 'فشل تشغيل وكيل الذكاء الاصطناعي' });
  }
});

// ----------------- VITE / STATIC SERVING ----------------- //

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚌 MASARA Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
