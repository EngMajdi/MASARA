import React from 'react';
import { SystemNotification } from '../types';
import { Bell, CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

interface NotificationsModalProps {
  notifications: SystemNotification[];
  onClose: () => void;
  onClear: () => void;
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({
  notifications,
  onClose,
  onClear
}) => {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 font-['Tajawal',sans-serif]">
      <div className="bg-white border border-slate-200/90 rounded-3xl p-5 sm:p-6 max-w-lg w-full shadow-2xl relative text-slate-900 my-auto z-10 max-h-[90vh] flex flex-col animate-fade-in">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3.5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl border border-blue-100 shrink-0">
              <Bell className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-base text-slate-900">مركز إشعارات نظام مَسارَا</h3>
          </div>
          <button 
            onClick={onClose} 
            className="text-slate-400 hover:text-slate-700 transition-colors p-2 rounded-xl hover:bg-slate-100"
            title="إغلاق النافذة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Notifications List */}
        <div className="space-y-3 flex-1 overflow-y-auto py-4 pr-1">
          {notifications.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400 font-medium">لا توجد إشعارات حالية بالنظام</div>
          ) : (
            notifications.map((notif) => (
              <div
                key={notif.id}
                className="bg-slate-50 border border-slate-200/80 p-3.5 rounded-2xl text-xs space-y-1 hover:bg-slate-100/60 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold min-w-0">
                    {notif.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                    {notif.type === 'alert' && <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />}
                    {notif.type === 'warning' && <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />}
                    {notif.type === 'info' && <Info className="w-4 h-4 text-blue-600 shrink-0" />}
                    <span className="text-slate-900 truncate">{notif.title}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono shrink-0">{notif.timestamp}</span>
                </div>
                <p className="text-slate-600 text-[11px] leading-relaxed font-medium">{notif.message}</p>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center pt-3 border-t border-slate-100 shrink-0">
          <button
            onClick={onClear}
            className="text-xs text-slate-500 hover:text-rose-600 font-bold transition-colors"
          >
            مسح جميع الإشعارات
          </button>
          <button
            onClick={onClose}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 py-2 rounded-xl text-xs transition-colors shadow-2xs"
          >
            إغلاق
          </button>
        </div>

      </div>
    </div>
  );
};
