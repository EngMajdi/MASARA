import React, { useState, useEffect } from 'react';
import { UserRole, Student, Bus, School, Route, SystemNotification, AIAgentWorkflowStep } from './types';
import {
  INITIAL_SCHOOLS,
  INITIAL_BUSES,
  INITIAL_STUDENTS,
  INITIAL_ROUTES,
  INITIAL_NOTIFICATIONS,
  INITIAL_WORKFLOW_STEPS
} from './mockData';
import { Header } from './components/Header';
import { MapView } from './components/MapView';
import { ParentPortal } from './components/ParentPortal';
import { DriverPortal } from './components/DriverPortal';
import { SchoolDashboard } from './components/SchoolDashboard';
import { AdminAIAgentPortal } from './components/AdminAIAgentPortal';
import { NotificationsModal } from './components/NotificationsModal';
import { AdvisorModal } from './components/AdvisorModal';
import { DataManagementModal } from './components/DataManagementModal';
import { ApprovalCenter } from './components/ApprovalCenter';
import { SimulationCenter } from './components/SimulationCenter';
import { AIOperationsFeed } from './components/AIOperationsFeed';
import { AuthModal, AuthUser } from './components/AuthModal';
import { Map, ChevronDown, ChevronUp } from 'lucide-react';

export default function App() {
  const [activeRole, setActiveRole] = useState<UserRole>('parent');

  // Authentication State
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => {
    try {
      const saved = localStorage.getItem('masara_auth_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [showAuthModal, setShowAuthModal] = useState(!currentUser);

  // Synchronized Application State
  const [schools, setSchools] = useState<School[]>(INITIAL_SCHOOLS);
  const [buses, setBuses] = useState<Bus[]>(INITIAL_BUSES);
  const [students, setStudents] = useState<Student[]>(INITIAL_STUDENTS);
  const [routes, setRoutes] = useState<Route[]>(INITIAL_ROUTES);
  const [notifications, setNotifications] = useState<SystemNotification[]>(INITIAL_NOTIFICATIONS);
  const [workflowSteps, setWorkflowSteps] = useState<AIAgentWorkflowStep[]>(INITIAL_WORKFLOW_STEPS);

  const [selectedBusId, setSelectedBusId] = useState<string>('bus-101');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('std-1');

  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showAdvisorModal, setShowAdvisorModal] = useState(false);
  const [showDataManagementModal, setShowDataManagementModal] = useState(false);
  const [showApprovalCenter, setShowApprovalCenter] = useState(false);
  const [showSimulationCenter, setShowSimulationCenter] = useState(false);
  const [showOperationsFeed, setShowOperationsFeed] = useState(false);
  const [isMapExpanded, setIsMapExpanded] = useState(true);

  // Realtime Sync Indicators
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');

  // Handle Login
  const handleLoginSuccess = (user: AuthUser) => {
    setCurrentUser(user);
    setActiveRole(user.role);
    setShowAuthModal(false);
    try {
      localStorage.setItem('masara_auth_user', JSON.stringify(user));
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    try {
      localStorage.removeItem('masara_auth_user');
    } catch (e) {
      console.error(e);
    }
    setShowAuthModal(true);
  };

  // Data entry handlers
  const handleAddStudent = (newStudentData: Omit<Student, 'id'>) => {
    const created: Student = {
      ...newStudentData,
      id: `std-${Date.now()}`
    };
    setStudents((prev) => [created, ...prev]);
    fetch('/api/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(created)
    }).catch(console.error);
  };

  const handleDeleteStudent = (id: string) => {
    setStudents((prev) => prev.filter((s) => s.id !== id));
    fetch(`/api/students/${id}`, { method: 'DELETE' }).catch(console.error);
  };

  const handleAddBus = (newBusData: Omit<Bus, 'id'>) => {
    const created: Bus = {
      ...newBusData,
      id: `bus-${Date.now()}`
    };
    setBuses((prev) => [created, ...prev]);
    fetch('/api/buses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(created)
    }).catch(console.error);
  };

  const handleDeleteBus = (id: string) => {
    setBuses((prev) => prev.filter((b) => b.id !== id));
    fetch(`/api/buses/${id}`, { method: 'DELETE' }).catch(console.error);
  };

  const handleAddRoute = (newRouteData: Omit<Route, 'id'>) => {
    const created: Route = {
      ...newRouteData,
      id: `route-${Date.now()}`
    };
    setRoutes((prev) => [created, ...prev]);
    fetch('/api/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(created)
    }).catch(console.error);
  };

  const handleDeleteRoute = (id: string) => {
    setRoutes((prev) => prev.filter((r) => r.id !== id));
    fetch(`/api/routes/${id}`, { method: 'DELETE' }).catch(console.error);
  };

  // Realtime Data Synchronization Function (السايركونانس)
  const syncAllData = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/all-data');
      if (res.ok) {
        const data = await res.json();
        if (data.schools) setSchools(data.schools);
        if (data.buses) setBuses(data.buses);
        if (data.students) setStudents(data.students);
        if (data.routes) setRoutes(data.routes);
        if (data.notifications) setNotifications(data.notifications);
        if (data.workflowSteps) setWorkflowSteps(data.workflowSteps);

        const now = new Date();
        setLastSyncTime(now.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      }
    } catch (err) {
      console.error('Realtime sync error:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  // Setup periodic sync every 2.5 seconds
  useEffect(() => {
    syncAllData();
    const interval = setInterval(() => {
      syncAllData();
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  // Handler: Student Boarding / Absence Status
  const handleUpdateStudentStatus = async (studentId: string, status: 'boarded' | 'absent') => {
    try {
      const res = await fetch(`/api/students/${studentId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (data.success) {
        syncAllData();
      }
    } catch (e) {
      console.error('Error updating status:', e);
    }
  };

  // Handler: Gemini AI Route Optimization
  const handleOptimizeRoutes = async (trafficCondition: string) => {
    const res = await fetch('/api/ai/optimize-routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: 'sch-1', trafficCondition })
    });
    const data = await res.json();
    syncAllData();
    return data;
  };

  // Handler: Gemini AI Reroute Simulation
  const handleTriggerReroute = async (busId: string, incident: string) => {
    const res = await fetch('/api/ai/detect-reroute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ busId, incidentDescription: incident })
    });
    const data = await res.json();
    syncAllData();
    return data;
  };

  // Handler: Start Route (Driver Portal)
  const handleStartRoute = async (busId: string) => {
    try {
      const res = await fetch(`/api/buses/${busId}/start-route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        syncAllData();
      }
    } catch (err) {
      console.error('Failed to notify backend on route start:', err);
    }
  };

  // Handler: Gemini AI Advisor Q&A
  const handleAskAdvisor = async (query: string) => {
    const res = await fetch('/api/ai/ask-advisor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        userRole: activeRole,
        currentBuses: buses,
        currentStudents: students,
        currentSchools: schools,
        currentRoutes: routes
      })
    });
    const data = await res.json();
    return data.answer;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-['Tajawal',sans-serif]">
      {/* App Main Header */}
      <Header
        activeRole={activeRole}
        setActiveRole={setActiveRole}
        notifications={notifications}
        onOpenNotifications={() => setShowNotificationsModal(true)}
        onOpenAdvisor={() => setShowAdvisorModal(true)}
        onOpenDataManagement={() => setShowDataManagementModal(true)}
        onOpenApprovalCenter={() => setShowApprovalCenter(true)}
        onOpenSimulationCenter={() => setShowSimulationCenter(true)}
        onOpenOperationsFeed={() => setShowOperationsFeed(true)}
        currentUser={currentUser}
        onOpenAuthModal={() => setShowAuthModal(true)}
        onLogout={handleLogout}
        isSyncing={isSyncing}
        lastSyncTime={lastSyncTime}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* Integrated Interactive Map Component */}
        <MapView
          buses={buses}
          schools={schools}
          students={students}
          routes={routes}
          selectedBusId={selectedBusId}
          onSelectBus={(busId) => setSelectedBusId(busId)}
          onSelectStudent={(stdId) => setSelectedStudentId(stdId)}
          isExpanded={isMapExpanded}
          onToggleExpand={() => setIsMapExpanded(!isMapExpanded)}
        />

        {/* Dynamic Role View Content */}
        <div className="pt-2">
          {activeRole === 'parent' && (
            <ParentPortal
              students={students}
              buses={buses}
              notifications={notifications}
              onUpdateStatus={handleUpdateStudentStatus}
              currentUser={currentUser}
            />
          )}

          {activeRole === 'driver' && (
            <DriverPortal
              buses={buses}
              students={students}
              routes={routes}
              onUpdateStatus={handleUpdateStudentStatus}
              onTriggerReroute={handleTriggerReroute}
              onStartRoute={handleStartRoute}
              currentUser={currentUser}
            />
          )}

          {activeRole === 'school' && (
            <SchoolDashboard
              schools={schools}
              students={students}
              buses={buses}
              currentUser={currentUser}
            />
          )}

          {activeRole === 'admin' && (
            <AdminAIAgentPortal
              workflowSteps={workflowSteps}
              routes={routes}
              onOptimizeRoutes={handleOptimizeRoutes}
              onTriggerReroute={handleTriggerReroute}
              onAskAdvisor={handleAskAdvisor}
            />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 mt-12 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-3">
          <div>
            <strong className="text-slate-800">مَسارَا MASARA OMAN</strong> © {new Date().getFullYear()} - منظومة النقل المدرسي الذكية مع مزامنة فورية (Gemini 2.5 Flash)
          </div>
          <div className="flex items-center gap-4 text-slate-500 font-medium">
            <span>مزامنة فورية حظية 🟢</span>
            <span>•</span>
            <span>تتبع حظي GPS</span>
            <span>•</span>
            <span>حوكمة وأمان الحافلات</span>
          </div>
        </div>
      </footer>

      {/* Modals */}
      <AuthModal
        isOpen={showAuthModal || !currentUser}
        onClose={() => {
          if (currentUser) {
            setShowAuthModal(false);
          }
        }}
        onLoginSuccess={handleLoginSuccess}
        targetRole={activeRole}
        isCancelable={!!currentUser}
      />

      {showNotificationsModal && (
        <NotificationsModal
          notifications={notifications}
          onClose={() => setShowNotificationsModal(false)}
          onClear={() => setNotifications([])}
        />
      )}

      {showAdvisorModal && (
        <AdvisorModal
          onClose={() => setShowAdvisorModal(false)}
          onAskAdvisor={handleAskAdvisor}
        />
      )}

      <DataManagementModal
        isOpen={showDataManagementModal}
        onClose={() => setShowDataManagementModal(false)}
        schools={schools}
        buses={buses}
        students={students}
        routes={routes}
        onAddStudent={handleAddStudent}
        onDeleteStudent={handleDeleteStudent}
        onAddBus={handleAddBus}
        onDeleteBus={handleDeleteBus}
        onAddRoute={handleAddRoute}
        onDeleteRoute={handleDeleteRoute}
      />

      <ApprovalCenter
        isOpen={showApprovalCenter}
        onClose={() => setShowApprovalCenter(false)}
        currentUser={currentUser}
      />

      <SimulationCenter
        isOpen={showSimulationCenter}
        onClose={() => setShowSimulationCenter(false)}
        currentUser={currentUser}
        onOpenApprovalCenter={() => {
          setShowSimulationCenter(false);
          setShowApprovalCenter(true);
        }}
      />

      <AIOperationsFeed
        isOpen={showOperationsFeed}
        onClose={() => setShowOperationsFeed(false)}
        currentUser={currentUser}
      />
    </div>
  );
}
