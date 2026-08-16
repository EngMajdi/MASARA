import { School, Student, Bus, Route, SystemNotification, AIAgentWorkflowStep } from './types';

export const INITIAL_SCHOOLS: School[] = [
  {
    id: 'sch-1',
    nameAr: 'مدرسة المسار الدولية - القرم (مسقط)',
    location: {
      lat: 23.6015,
      lng: 58.4210,
      address: 'شارع السلطان قابوس، حي القرم، مسقط'
    },
    startTime: '07:00 ص',
    endTime: '01:30 م',
    totalStudents: 340,
    activeBusesCount: 12
  },
  {
    id: 'sch-2',
    nameAr: 'مدرسة الشاطئ المتقدمة - الخوض',
    location: {
      lat: 23.6210,
      lng: 58.1950,
      address: 'شارع الجامعة، حي الخوض، السيب'
    },
    startTime: '07:15 ص',
    endTime: '01:45 م',
    totalStudents: 280,
    activeBusesCount: 9
  }
];

export const INITIAL_BUSES: Bus[] = [
  {
    id: 'bus-101',
    busNumber: 'حافلة 101',
    plateNumber: 'ط ع 4589',
    driverName: 'الكابتن سعيد بن حمد البوسعيدي',
    driverPhone: '+968 9123 4567',
    driverAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200',
    capacity: 24,
    currentOccupancy: 18,
    currentLocation: { lat: 23.5980, lng: 58.4100 },
    speedKmH: 42,
    status: 'en_route_school',
    fuelLevel: 88,
    safetyScore: 98,
    assignedRouteId: 'route-101',
    nextStopName: 'حي القرم - المجمع السكني',
    nextStopEtaMins: 4
  },
  {
    id: 'bus-102',
    busNumber: 'حافلة 102',
    plateNumber: 'م ص 1234',
    driverName: 'الكابتن سالم بن خلفان المعمري',
    driverPhone: '+968 9555 6677',
    driverAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200',
    capacity: 20,
    currentOccupancy: 15,
    currentLocation: { lat: 23.6120, lng: 58.2100 },
    speedKmH: 38,
    status: 'en_route_pickup',
    fuelLevel: 75,
    safetyScore: 95,
    assignedRouteId: 'route-102',
    nextStopName: 'حي الخوض - شارع الجامعة',
    nextStopEtaMins: 7
  },
  {
    id: 'bus-103',
    busNumber: 'حافلة 103 (احتياطية)',
    plateNumber: 'ر ط 7890',
    driverName: 'الكابتن ناصر بن راشد الهنائي',
    driverPhone: '+968 9234 5678',
    driverAvatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200',
    capacity: 28,
    currentOccupancy: 0,
    currentLocation: { lat: 23.6015, lng: 58.4210 },
    speedKmH: 0,
    status: 'idle',
    fuelLevel: 100,
    safetyScore: 100,
    assignedRouteId: 'route-103',
    nextStopName: 'المدرسة (مركز التجمع)',
    nextStopEtaMins: 0
  }
];

export const INITIAL_STUDENTS: Student[] = [
  {
    id: 'std-1',
    name: 'مريم بنت أحمد البوسعيدية',
    grade: 'الصف الخامس الابتدائي',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&q=80&w=200',
    schoolId: 'sch-1',
    schoolName: 'مدرسة المسار الدولية - القرم (مسقط)',
    parentId: 'par-1',
    parentName: 'أحمد بن سيف البوسعيدي',
    parentPhone: '+968 9111 2233',
    busId: 'bus-101',
    busNumber: 'حافلة 101',
    pickupPoint: {
      lat: 23.5950,
      lng: 58.4050,
      address: 'حي القرم، شارع النهضة',
      nameAr: 'نقطة توقف حي القرم (أ)'
    },
    status: 'boarded',
    pickupTimePlanned: '06:40 ص',
    pickupTimeActual: '06:42 ص',
    seatNumber: '04A'
  },
  {
    id: 'std-2',
    name: 'الخليل بن أحمد البوسعيدي',
    grade: 'الصف الثاني الابتدائي',
    avatar: 'https://images.unsplash.com/photo-1485546246426-74dc88dec4d9?auto=format&fit=crop&q=80&w=200',
    schoolId: 'sch-1',
    schoolName: 'مدرسة المسار الدولية - القرم (مسقط)',
    parentId: 'par-1',
    parentName: 'أحمد بن سيف البوسعيدي',
    parentPhone: '+968 9111 2233',
    busId: 'bus-101',
    busNumber: 'حافلة 101',
    pickupPoint: {
      lat: 23.5950,
      lng: 58.4050,
      address: 'حي القرم، شارع النهضة',
      nameAr: 'نقطة توقف حي القرم (أ)'
    },
    status: 'boarded',
    pickupTimePlanned: '06:40 ص',
    pickupTimeActual: '06:42 ص',
    seatNumber: '04B'
  },
  {
    id: 'std-3',
    name: 'سالم بن فهد الحوسني',
    grade: 'الصف السادس الابتدائي',
    avatar: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&q=80&w=200',
    schoolId: 'sch-1',
    schoolName: 'مدرسة المسار الدولية - القرم (مسقط)',
    parentId: 'par-2',
    parentName: 'فهد بن سلطان الحوسني',
    parentPhone: '+968 9444 5566',
    busId: 'bus-101',
    busNumber: 'حافلة 101',
    pickupPoint: {
      lat: 23.5890,
      lng: 58.4120,
      address: 'حي العذيبة، قرب حديقة العذيبة',
      nameAr: 'نقطة توقف حي العذيبة (ب)'
    },
    status: 'waiting',
    pickupTimePlanned: '06:50 ص',
    seatNumber: '07A'
  },
  {
    id: 'std-4',
    name: 'ريم بنت عبدالله الزدجالية',
    grade: 'الصف الرابع الابتدائي',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=200',
    schoolId: 'sch-1',
    schoolName: 'مدرسة المسار الدولية - القرم (مسقط)',
    parentId: 'par-3',
    parentName: 'عبدالله بن علي الزدجالي',
    parentPhone: '+968 9777 8899',
    busId: 'bus-102',
    busNumber: 'حافلة 102',
    pickupPoint: {
      lat: 23.6150,
      lng: 58.2050,
      address: 'حي الخوض، شارع البركات',
      nameAr: 'نقطة توقف حي الخوض (ج)'
    },
    status: 'waiting',
    pickupTimePlanned: '06:45 ص',
    seatNumber: '02B'
  },
  {
    id: 'std-5',
    name: 'محمد بن ناصر البلوشي',
    grade: 'الصف الثالث الابتدائي',
    avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=200',
    schoolId: 'sch-1',
    schoolName: 'مدرسة المسار الدولية - القرم (مسقط)',
    parentId: 'par-4',
    parentName: 'ناصر بن خميس البلوشي',
    parentPhone: '+968 9222 3344',
    busId: 'bus-101',
    busNumber: 'حافلة 101',
    pickupPoint: {
      lat: 23.6020,
      lng: 58.3980,
      address: 'حي الغبرة الشمالية',
      nameAr: 'نقطة توقف الغبرة الشمالية'
    },
    status: 'absent',
    pickupTimePlanned: '06:35 ص',
    seatNumber: '01A'
  }
];

export const INITIAL_ROUTES: Route[] = [
  {
    id: 'route-101',
    routeNameAr: 'مسار القرم - العذيبة - الغبرة (الذكي #1)',
    schoolId: 'sch-1',
    busId: 'bus-101',
    waypoints: [
      { lat: 23.6020, lng: 58.3980, type: 'start', label: 'بداية الانطلاق (حي الغبرة)' },
      { lat: 23.5950, lng: 58.4050, type: 'pickup', label: 'نقطة القرم أ (مريم والخليل)' },
      { lat: 23.5890, lng: 58.4120, type: 'pickup', label: 'نقطة العذيبة ب (سالم)' },
      { lat: 23.6015, lng: 58.4210, type: 'school', label: 'مدرسة المسار الدولية - القرم (المحطة الأخيرة)' }
    ],
    stops: [
      {
        id: 'stop-1',
        nameAr: 'نقطة توقف الغبرة الشمالية',
        lat: 23.6020,
        lng: 58.3980,
        studentIds: ['std-5'],
        estimatedTime: '06:35 ص',
        completed: true,
        orderSequence: 1
      },
      {
        id: 'stop-2',
        nameAr: 'نقطة توقف حي القرم (أ)',
        lat: 23.5950,
        lng: 58.4050,
        studentIds: ['std-1', 'std-2'],
        estimatedTime: '06:40 ص',
        completed: true,
        orderSequence: 2
      },
      {
        id: 'stop-3',
        nameAr: 'نقطة توقف حي العذيبة (ب)',
        lat: 23.5890,
        lng: 58.4120,
        studentIds: ['std-3'],
        estimatedTime: '06:50 ص',
        completed: false,
        orderSequence: 3
      }
    ],
    totalDistanceKm: 8.4,
    estimatedDurationMins: 22,
    status: 'active',
    aiEfficiencyScore: 96,
    carbonSavedKg: 4.2,
    aiRationaleAr: 'تم التجميع الموقعي الذكي للطلبة المتقاربين في حي القرم والعذيبة لتقليل الوقوف متكرراً، مع تحويل المسار لتجنب ازدحام شارع السلطان قابوس.'
  },
  {
    id: 'route-102',
    routeNameAr: 'مسار الخوض - الموالح (الذكي #2)',
    schoolId: 'sch-1',
    busId: 'bus-102',
    waypoints: [
      { lat: 23.6150, lng: 58.2050, type: 'pickup', label: 'نقطة الخوض (ريم)' },
      { lat: 23.6015, lng: 58.4210, type: 'school', label: 'مدرسة المسار الدولية - القرم' }
    ],
    stops: [
      {
        id: 'stop-4',
        nameAr: 'نقطة توقف حي الخوض (ج)',
        lat: 23.6150,
        lng: 58.2050,
        studentIds: ['std-4'],
        estimatedTime: '06:45 ص',
        completed: false,
        orderSequence: 1
      }
    ],
    totalDistanceKm: 6.2,
    estimatedDurationMins: 16,
    status: 'active',
    aiEfficiencyScore: 92,
    carbonSavedKg: 3.1,
    aiRationaleAr: 'تم تخصيص المسار المباشر عبر طريق مسقط السريع لضمان وصول الطلاب قبل الوقت المحدد بـ 10 دقائق.'
  }
];

export const INITIAL_NOTIFICATIONS: SystemNotification[] = [
  {
    id: 'notif-1',
    timestamp: '06:42 ص',
    title: 'تأكيد صعود الطالبة مريم',
    message: 'تم صعود الطالبة مريم بنت أحمد البوسعيدية إلى حافلة 101 بنجاح.',
    type: 'success',
    targetRole: 'parent',
    read: false
  },
  {
    id: 'notif-2',
    timestamp: '06:45 ص',
    title: 'تنبيه يقترب الوصول',
    message: 'الحافلة 101 تبعد 4 دقائق عن نقطة توقف حي العذيبة (ب).',
    type: 'info',
    targetRole: 'parent',
    read: false
  },
  {
    id: 'notif-3',
    timestamp: '06:30 ص',
    title: 'إشعارات الوكيل الذكي (MASARA OMAN AI)',
    message: 'تم إعادة حساب المسار تلقائياً للحافلة 101 لتفادي اختناق مروري عند مدخل حي القرم بمسقط.',
    type: 'alert',
    targetRole: 'all',
    read: true
  }
];

export const INITIAL_WORKFLOW_STEPS: AIAgentWorkflowStep[] = [
  {
    stepNumber: 1,
    titleAr: '1. جمع البيانات (Data Intake)',
    descriptionAr: 'تجميع بيانات مواقع الطلبة في مسقط والولايات، أوقات المدارس، سعة الحافلات، وحالة المرور والطقس.',
    subTasks: [
      'تحديث إحداثيات الطلبة وأولياء الأمور في ولاية السيب ومسقط',
      'فحص السائقين والحافلات النشطة',
      'استعلام حالة الازدحام المروري على شارع السلطان قابوس'
    ],
    status: 'completed',
    timestamp: '06:00 ص'
  },
  {
    stepNumber: 2,
    titleAr: '2. تحليل البيانات (Data Analysis)',
    descriptionAr: 'معالجة المسافات، أوقات الرحلات عبر طريق مسقط السريع، السعة الاستيعابية، ونقاط الازدحام.',
    subTasks: [
      'حساب مصفوفة الأزواج والمسافات (OD Matrix) لمناطق مسقط',
      'تقدير حمولة كل حافلة وتوزيع الطلاب',
      'تحديد النوافذ الزمنية المستهدفة للوصول للمدرسة'
    ],
    status: 'completed',
    timestamp: '06:05 ص'
  },
  {
    stepNumber: 3,
    titleAr: '3. محرك الذكاء الاصطناعي (AI Routing Engine)',
    descriptionAr: 'خوارزميات التجمُّع الذكي وإنشاء مسارات ديناميكية تحسّن الوقت وتخفض الانبعاثات الكربونية.',
    subTasks: [
      'تجميع الطلبة القريبين في نقاط توقف آمنة',
      'تحسين تسلسل محطات التوقف',
      'توقّع وقت الوصول الدقيق (ETA prediction)'
    ],
    status: 'completed',
    timestamp: '06:10 ص'
  },
  {
    stepNumber: 4,
    titleAr: '4. اتخاذ القرار (Decision Optimization)',
    descriptionAr: 'اختيار المسار الأمثل، توزيع الطلبة على الحافلات المناسبة، وجدولة المواعيد بناءً على الأمان والسرعة.',
    subTasks: [
      'اعتماد أفضل مسار مقترح عبر طريق مسقط السريع',
      'موازنة أوقات الانتظار لكل طالب',
      'التحقق من معايير الأمان والسلامة العمانية'
    ],
    status: 'completed',
    timestamp: '06:12 ص'
  },
  {
    stepNumber: 5,
    titleAr: '5. المخرجات وتحديث الأنظمة (Dynamic Dispatch)',
    descriptionAr: 'إرسال جدول الملاحة لتطبيق السائق، وبث التتبع المباشر لتطبيقات ولي الأمر والمدرسة.',
    subTasks: [
      'إرسال الخريطة والاتجاهات لتطبيق السائق',
      'تفعيل التتبع المباشر لأولياء الأمور',
      'تزويد المدرسة بلوحة رصد الحضور والتنقل'
    ],
    status: 'completed',
    timestamp: '06:15 ص'
  }
];
