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
import { legacyAuthHeaders } from './services/legacyAuthHeaders';

export default function App() {
  const [activeRole, setActiveRole] = useState<UserRole>(() => {
    try {
      const saved = localStorage.getItem('masara_auth_user');
      return saved ? (JSON.parse(saved).role as UserRole) : 'parent';
    } catch {
      return 'parent';
    }
  });

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => {
    try {
      const saved = localStorage.getItem('masara_auth_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [schools, setSchools] = useState<School[]>(INITIAL_SCHOOLS);
  const [buses, setBuses] = useState<Bus[]>(INITIAL_BUSES);
  const [students, setStudents] = useState<Student[]>(INITIAL_STUDENTS);
  const [routes, setRoutes] = useState<Route[]>(INITIAL_ROUTES);
  const [notifications, setNotifications] = useState<SystemNotification[]>(INITIAL_NOTIFICATIONS);
  const [workflowSteps, setWorkflowSteps] = useState<AIAgentWorkflowStep[]>(INITIAL_WORKFLOW_STEPS);

  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showAdvisorModal, setShowAdvisorModal] = useState(false);
  const [showDataManagementModal, setShowDataManagementModal] = useState(false);
  const [showEmployeeManagement, setShowEmployeeManagement] = useState(false);
  const [showApprovalCenter, setShowApprovalCenter] = useState(false);
  const [showSimulationCenter, setShowSimulationCenter] = useState(false);
  const [showOperationsFeed, setShowOperationsFeed] = useState(false);

  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');

  const handleLoginSuccess = (user: AuthUser) => {
    setCurrentUser(user);
    setActiveRole(user.role);
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
  };

  const handleAddStudent = (newStudentData: Omit<Student, 'id'>) => {
    const created: Student = { ...newStudentData, id: `std-${Date.now()}` };
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
    const created: Bus = { ...newBusData, id: `bus-${Date.now()}` };
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
    const created: Route = { ...newRouteData, id: `route-${Date.now()}` };
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

  useEffect(() => {
    syncAllData();
    const interval = setInterval(() => {
      syncAllData();
    }, 2500);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.sessionToken]);

  const handleUpdateStudentStatus = async (studentId: string, status: 'boarded' | 'absent') => {
    try {
      const res = await fetch(`/api/students/${studentId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) },
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (data.success) syncAllData();
    } catch (e) {
      console.error('Error updating status:', e);
    }
  };

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

  const handleStartRoute = async (busId: string) => {
    try {
      const res = await fetch(`/api/buses/${busId}/start-route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...legacyAuthHeaders(currentUser?.sessionToken) }
      });
      if (res.ok) syncAllData();
    } catch (err) {
      console.error('Failed to notify backend on route start:', err);
    }
  };

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

  // Fleet-wide map data for School/Admin (the only roles whose IA calls for
  // a full-fleet map). Parent/Driver derive their own single-bus scoped
  // view internally from the already-filtered students/buses they own.
  const fleetMapBuses = useMemo(() => buses, [buses]);
  const fleetMapStudents = useMemo(() => students, [students]);

  const visibleNotifications = useMemo(() => {
    if (!currentUser) return notifications;
    return notifications.filter((n) => n.targetRole === 'all' || n.targetRole === currentUser.role);
  }, [notifications, currentUser]);

  if (!currentUser) {
    return <AuthModal onLoginSuccess={handleLoginSuccess} />;
  }

  if (currentUser.mustChangePassword) {
    return <ForcedPasswordChangeGate currentUser={currentUser} onPasswordChangedRequireRelogin={handleLogout} />;
  }

  return (
    <div className="min-h-screen bg-canvas text-text-primary flex flex-col">
      <Header
        notifications={visibleNotifications}
        onOpenNotifications={() => setShowNotificationsModal(true)}
        onOpenAdvisor={() => setShowAdvisorModal(true)}
        currentUser={currentUser}
        onLogout={handleLogout}
        isSyncing={isSyncing}
      />

      <main className="flex-1 max-w-5xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 pb-24 sm:pb-8">
        {activeRole === 'parent' && (
          <ParentPortal students={students} buses={buses} notifications={visibleNotifications} onUpdateStatus={handleUpdateStudentStatus} currentUser={currentUser} />
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
            buses={fleetMapBuses}
            routes={routes}
            currentUser={currentUser}
            onOpenDataManagement={() => setShowDataManagementModal(true)}
            onOpenApprovalCenter={() => setShowApprovalCenter(true)}
          />
        )}

        {activeRole === 'admin' && (
          <AdminAIAgentPortal
            workflowSteps={workflowSteps}
            routes={routes}
            buses={fleetMapBuses}
            students={fleetMapStudents}
            schools={schools}
            onOptimizeRoutes={handleOptimizeRoutes}
            onTriggerReroute={handleTriggerReroute}
            currentUser={currentUser}
            onOpenDataManagement={() => setShowDataManagementModal(true)}
            onOpenEmployeeManagement={() => setShowEmployeeManagement(true)}
            onOpenApprovalCenter={() => setShowApprovalCenter(true)}
            onOpenSimulationCenter={() => setShowSimulationCenter(true)}
            onOpenOperationsFeed={() => setShowOperationsFeed(true)}
          />
        )}
      </main>

      <footer className="hidden sm:block bg-white border-t border-border-default py-5 text-center text-sm text-text-secondary">
        <strong className="text-text-primary">مَسارَا MASARA</strong> © {new Date().getFullYear()} — النقل المدرسي الآمن في سلطنة عمان
      </footer>

      {showNotificationsModal && <NotificationsModal notifications={visibleNotifications} onClose={() => setShowNotificationsModal(false)} onClear={() => setNotifications([])} />}
      {showAdvisorModal && <AdvisorModal onClose={() => setShowAdvisorModal(false)} onAskAdvisor={handleAskAdvisor} />}

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

      <EmployeeManagementModal isOpen={showEmployeeManagement} onClose={() => setShowEmployeeManagement(false)} currentUser={currentUser} />

      <ApprovalCenter isOpen={showApprovalCenter} onClose={() => setShowApprovalCenter(false)} currentUser={currentUser} />

      <SimulationCenter
        isOpen={showSimulationCenter}
        onClose={() => setShowSimulationCenter(false)}
        currentUser={currentUser}
        onOpenApprovalCenter={() => {
          setShowSimulationCenter(false);
          setShowApprovalCenter(true);
        }}
      />

      <AIOperationsFeed isOpen={showOperationsFeed} onClose={() => setShowOperationsFeed(false)} currentUser={currentUser} />
    </div>
  );
}
