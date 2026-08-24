import React, { useState, useEffect, useMemo } from 'react';
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
import { ForcedPasswordChangeGate } from './components/ForcedPasswordChangeGate';
import { EmployeeManagementModal } from './components/EmployeeManagementModal';
import { ParentStatusSummary } from './components/ParentStatusSummary';
import { legacyAuthHeaders } from './services/legacyAuthHeaders';
import { Map, ChevronDown, ChevronUp } from 'lucide-react';

export default function App() {
  // BUG FIX: activeRole used to hardcode 'parent' as its initial value and
  // was only ever updated via setActiveRole inside handleLoginSuccess below
  // — meaning it was never restored from the saved session the way
  // currentUser is. A driver/school/admin whose session survived a page
  // reload (currentUser correctly restored, name shown in the header,
  // "تسجيل الخروج" present) would still see the PARENT portal rendered
  // underneath, since {activeRole === 'parent' && <ParentPortal/>} etc. is
  // what actually decides which portal renders (live-verified: driver1's
  // session after a reload rendered ParentPortal, not DriverPortal). Now
  // initialized from the same saved session, exactly like currentUser.
  const [activeRole, setActiveRole] = useState<UserRole>(() => {
    try {
      const saved = localStorage.getItem('masara_auth_user');
      return saved ? (JSON.parse(saved).role as UserRole) : 'parent';
    } catch {
      return 'parent';
    }
  });

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
  const [showEmployeeManagement, setShowEmployeeManagement] = useState(false);
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
    if (currentUser?.sessionToken) {
      fetch('/api/auth/logout', { method: 'POST', headers: legacyAuthHeaders(currentUser.sessionToken) }).catch(() => {});
    }
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
      headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) },
      body: JSON.stringify(created)
    }).catch(console.error);
  };

  const handleDeleteStudent = (id: string) => {
    setStudents((prev) => prev.filter((s) => s.id !== id));
    fetch(`/api/students/${id}`, { method: 'DELETE', headers: legacyAuthHeaders(currentUser?.sessionToken) }).catch(console.error);
  };

  const handleAddBus = (newBusData: Omit<Bus, 'id'>) => {
    const created: Bus = {
      ...newBusData,
      id: `bus-${Date.now()}`
    };
    setBuses((prev) => [created, ...prev]);
    fetch('/api/buses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) },
      body: JSON.stringify(created)
    }).catch(console.error);
  };

  const handleDeleteBus = (id: string) => {
    setBuses((prev) => prev.filter((b) => b.id !== id));
    fetch(`/api/buses/${id}`, { method: 'DELETE', headers: legacyAuthHeaders(currentUser?.sessionToken) }).catch(console.error);
  };

  const handleAddRoute = (newRouteData: Omit<Route, 'id'>) => {
    const created: Route = {
      ...newRouteData,
      id: `route-${Date.now()}`
    };
    setRoutes((prev) => [created, ...prev]);
    fetch('/api/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) },
      body: JSON.stringify(created)
    }).catch(console.error);
  };

  const handleDeleteRoute = (id: string) => {
    setRoutes((prev) => prev.filter((r) => r.id !== id));
    fetch(`/api/routes/${id}`, { method: 'DELETE', headers: legacyAuthHeaders(currentUser?.sessionToken) }).catch(console.error);
  };

  // Realtime Data Synchronization Function (السايركونانس)
  const syncAllData = async () => {
    if (!currentUser?.sessionToken) return;
    setIsSyncing(true);
    try {
      const res = await fetch('/api/all-data', { headers: legacyAuthHeaders(currentUser.sessionToken) });
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

  // Setup periodic sync every 2.5 seconds. Phase 7A: re-created whenever the
  // session token changes (login/logout) — syncAllData reads currentUser
  // via closure, so the interval must restart on that value's identity
  // changing, or a login that happens after mount would never be picked up.
  useEffect(() => {
    syncAllData();
    const interval = setInterval(() => {
      syncAllData();
    }, 2500);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.sessionToken]);

  // Handler: Student Boarding / Absence Status
  const handleUpdateStudentStatus = async (studentId: string, status: 'boarded' | 'absent') => {
    try {
      const res = await fetch(`/api/students/${studentId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) },
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

  // Handler: Gemini AI Route Optimization. No per-school ownership exists yet
  // for the 'school'/'admin' roles (unlike driver->bus/parent->student since
  // Phase 7K) — schoolId is derived from the live synced schools list rather
  // than a hardcoded 'sch-1' literal, so this stays correct if a second real
  // school is ever seeded instead of silently pointing at a stale id.
  const handleOptimizeRoutes = async (trafficCondition: string) => {
    const res = await fetch('/api/ai/optimize-routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) },
      body: JSON.stringify({ schoolId: schools[0]?.id, trafficCondition })
    });
    const data = await res.json();
    syncAllData();
    return data;
  };

  // Handler: Gemini AI Reroute Simulation
  const handleTriggerReroute = async (busId: string, incident: string) => {
    const res = await fetch('/api/ai/detect-reroute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) },
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
        headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) }
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
      headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) },
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

  // Live map scoping by role: admin/school keep full fleet visibility
  // (matches their existing unrestricted access everywhere else in the
  // app); driver sees only their own bus (legacy_buses.driverId, enforced
  // server-side since Phase 7K); parent sees only their own children's
  // bus(es). Schools stay unfiltered — a small, fixed set of institution
  // locations, not personal data. Without this, the shared map showed
  // every bus and every child's pickup point to every logged-in role
  // regardless of ownership.
  const mapBuses = useMemo(() => {
    if (!currentUser) return buses;
    if (currentUser.role === 'driver') {
      return buses.filter((b) => b.driverId === currentUser.id);
    }
    if (currentUser.role === 'parent') {
      const myBusIds = new Set(students.filter((s) => s.parentId === currentUser.id).map((s) => s.busId));
      return buses.filter((b) => myBusIds.has(b.id));
    }
    return buses;
  }, [buses, students, currentUser]);

  const mapStudents = useMemo(() => {
    if (!currentUser) return students;
    if (currentUser.role === 'driver') {
      const myBusIds = new Set(mapBuses.map((b) => b.id));
      return students.filter((s) => myBusIds.has(s.busId));
    }
    if (currentUser.role === 'parent') {
      return students.filter((s) => s.parentId === currentUser.id);
    }
    return students;
  }, [students, currentUser, mapBuses]);

  // UX audit P1-3: notifications carry a targetRole field (per-role, plus
  // 'all' for genuinely cross-role notices), but nothing ever filtered on
  // it — every notification, including admin-only AI-analysis notices,
  // rendered in every role's bell/panel. 'all' still means "every role
  // should see this" (e.g. a real safety alert); it does not mean
  // "unfiltered by default."
  const visibleNotifications = useMemo(() => {
    if (!currentUser) return notifications;
    return notifications.filter((n) => n.targetRole === 'all' || n.targetRole === currentUser.role);
  }, [notifications, currentUser]);

  // Phase 8B — a forced first-login password change blocks the ENTIRE app,
  // not just a dismissible overlay on top of it: no header, no map, no
  // portal renders underneath. The backend already revokes every session
  // on a successful change (Phase 7H's session-invalidation decision), so
  // the only correct next step is a full logout back to a fresh login —
  // never a silent continuation with the same (now-invalid) token.
  if (currentUser?.mustChangePassword) {
    return (
      <ForcedPasswordChangeGate
        currentUser={currentUser}
        onPasswordChangedRequireRelogin={handleLogout}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-['Tajawal',sans-serif]">
      {/* App Main Header */}
      <Header
        activeRole={activeRole}
        setActiveRole={setActiveRole}
        notifications={visibleNotifications}
        onOpenNotifications={() => setShowNotificationsModal(true)}
        onOpenAdvisor={() => setShowAdvisorModal(true)}
        onOpenDataManagement={() => setShowDataManagementModal(true)}
        onOpenEmployeeManagement={() => setShowEmployeeManagement(true)}
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
        {/* UX audit P1-1: a parent's first glance must answer "is my child
            safe" before anything else — rendered above the map deliberately,
            not buried inside ParentPortal below it. */}
        {activeRole === 'parent' && (
          <ParentStatusSummary students={students} buses={buses} currentUser={currentUser} />
        )}

        {/* Integrated Interactive Map Component */}
        <MapView
          buses={mapBuses}
          schools={schools}
          students={mapStudents}
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
              notifications={visibleNotifications}
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
              buses={buses}
              students={students}
              onOptimizeRoutes={handleOptimizeRoutes}
              onTriggerReroute={handleTriggerReroute}
              onAskAdvisor={handleAskAdvisor}
              currentUser={currentUser}
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
          notifications={visibleNotifications}
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
        currentUser={currentUser}
        onAddStudent={handleAddStudent}
        onDeleteStudent={handleDeleteStudent}
        onAddBus={handleAddBus}
        onDeleteBus={handleDeleteBus}
        onAddRoute={handleAddRoute}
        onDeleteRoute={handleDeleteRoute}
      />

      <EmployeeManagementModal
        isOpen={showEmployeeManagement}
        onClose={() => setShowEmployeeManagement(false)}
        currentUser={currentUser}
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
