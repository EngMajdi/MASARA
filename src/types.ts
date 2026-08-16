export type UserRole = 'parent' | 'driver' | 'school' | 'admin';

export type StudentStatus = 'at_home' | 'waiting' | 'boarded' | 'at_school' | 'absent';

export interface Student {
  id: string;
  name: string;
  grade: string;
  avatar: string;
  schoolId: string;
  schoolName: string;
  parentId: string;
  parentName: string;
  parentPhone: string;
  busId: string;
  busNumber: string;
  pickupPoint: {
    lat: number;
    lng: number;
    address: string;
    nameAr: string;
  };
  status: StudentStatus;
  pickupTimePlanned: string;
  pickupTimeActual?: string;
  seatNumber: string;
}

export interface School {
  id: string;
  nameAr: string;
  location: {
    lat: number;
    lng: number;
    address: string;
  };
  startTime: string;
  endTime: string;
  totalStudents: number;
  activeBusesCount: number;
}

export interface Bus {
  id: string;
  busNumber: string;
  plateNumber: string;
  driverName: string;
  driverPhone: string;
  driverAvatar: string;
  capacity: number;
  currentOccupancy: number;
  currentLocation: {
    lat: number;
    lng: number;
  };
  speedKmH: number;
  status: 'idle' | 'en_route_pickup' | 'en_route_school' | 'returning' | 'maintenance';
  fuelLevel: number; // percentage
  safetyScore: number; // 0-100
  assignedRouteId: string;
  nextStopName: string;
  nextStopEtaMins: number;
}

export interface PickupStop {
  id: string;
  nameAr: string;
  lat: number;
  lng: number;
  studentIds: string[];
  estimatedTime: string;
  completed: boolean;
  orderSequence: number;
}

export interface Route {
  id: string;
  routeNameAr: string;
  schoolId: string;
  busId: string;
  waypoints: {
    lat: number;
    lng: number;
    type: 'start' | 'pickup' | 'school';
    label: string;
  }[];
  stops: PickupStop[];
  totalDistanceKm: number;
  estimatedDurationMins: number;
  status: 'active' | 'scheduled' | 'completed' | 'rerouted';
  aiEfficiencyScore: number;
  carbonSavedKg: number;
  aiRationaleAr?: string;
}

export interface SystemNotification {
  id: string;
  timestamp: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'alert';
  targetRole: UserRole | 'all';
  read: boolean;
}

export interface AIAgentWorkflowStep {
  stepNumber: number;
  titleAr: string;
  descriptionAr: string;
  subTasks: string[];
  status: 'completed' | 'processing' | 'idle';
  timestamp?: string;
}

export interface AIOptimizationResult {
  routes: Route[];
  summaryAr: string;
  aiEfficiencyGainPercentage: number;
  timeSavedMins: number;
  fuelSavedLiters: number;
  safetyAlerts: string[];
}
