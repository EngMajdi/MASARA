import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, Loader2, Bus, PhoneCall, UserCheck, Clock } from 'lucide-react';
import { Sheet, Button, Input } from './ui';

interface AdvisorModalProps {
  onClose: () => void;
  onAskAdvisor: (query: string) => Promise<string>;
}

const FormattedText: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split('\n');
  return (
    <div className="space-y-1">
      {lines.map((line, lIdx) => {
        if (!line.trim()) return <div key={lIdx} className="h-1.5" />;
        const parts = line.split(/(\*\*.*?\*\*)/g);
        return (
          <p key={lIdx} className="leading-relaxed">
            {parts.map((part, pIdx) =>
              part.startsWith('**') && part.endsWith('**') ? (
                <strong key={pIdx} className="font-bold text-primary">
                  {part.slice(2, -2)}
                </strong>
              ) : (
                part
              )
            )}
          </p>
        );
      })}
    </div>
  );
};

export const AdvisorModal: React.FC<AdvisorModalProps> = ({ onClose, onAskAdvisor }) => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<Array<{ sender: 'user' | 'ai'; text: string }>>([
    {
      sender: 'ai',
      text: `مرحباً بك في **مساعد مَسارَا الذكي**!

أنا متصل مباشرة ببيانات الأسطول والطلاب. يمكنك سؤالي مثل:
• **"أين الباص ومتى يصل؟"**
• **"هل صعد الطالب الخليل البوسعيدي الحافلة؟"**
• **"ما هو رقم هاتف السائق؟"**`
    }
  ]);

  const quickQuestions = [
    { label: 'أين حافلة 101 ومتى يصل؟', icon: Bus },
    { label: 'هل صعدت مريم البوسعيدية الحافلة؟', icon: UserCheck },
    { label: 'ما هي حالة الطالب الخليل البوسعيدي؟', icon: Clock },
    { label: 'ما هو رقم هاتف سائق الحافلة؟', icon: PhoneCall }
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSend = async (userText: string) => {
    if (!userText.trim() || loading) return;
    setQuery('');
    setMessages((prev) => [...prev, { sender: 'user', text: userText }]);
    setLoading(true);
    try {
      const answer = await onAskAdvisor(userText);
      setMessages((prev) => [...prev, { sender: 'ai', text: answer }]);
    } catch (e) {
      setMessages((prev) => [...prev, { sender: 'ai', text: 'عذراً، حدث خطأ أثناء معالجة الاستفسار. يرجى المحاولة مرة أخرى.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet
      isOpen
      onClose={onClose}
      title="مساعد مَسارَا الذكي"
      subtitle="متصل بالتتبع الحي للأسطول والطلاب"
      footer={
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend(query);
          }}
          className="flex gap-2"
        >
          <Input placeholder="اكتب سؤالك…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button type="submit" disabled={loading || !query.trim()} icon={<Send className="w-4 h-4" />}>
            إرسال
          </Button>
        </form>
      }
    >
      <div className="space-y-3">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`p-3.5 rounded-2xl max-w-[85%] text-sm leading-relaxed ${
              msg.sender === 'user' ? 'bg-primary text-white mr-auto rounded-tl-none' : 'bg-surface-sunken border border-border-default text-text-secondary ml-auto rounded-tr-none'
            }`}
          >
            <FormattedText text={msg.text} />
          </div>
        ))}

        {loading && (
          <div className="bg-surface-sunken border border-border-default p-3.5 rounded-2xl text-text-secondary flex items-center gap-2 text-sm ml-auto max-w-[85%] rounded-tr-none">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>جاري القراءة من البيانات الحية…</span>
          </div>
        )}
        <div ref={messagesEndRef} />

        <div className="pt-2 border-t border-border-default">
          <p className="text-xs font-bold text-text-tertiary mb-2">أسئلة سريعة</p>
          <div className="flex flex-wrap gap-1.5">
            {quickQuestions.map((q, qIdx) => {
              const IconComponent = q.icon;
              return (
                <button
                  key={qIdx}
                  type="button"
                  onClick={() => handleSend(q.label)}
                  disabled={loading}
                  className="bg-surface-sunken hover:bg-slate-100 text-text-secondary px-2.5 py-1.5 rounded-lg border border-border-default text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  <IconComponent className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span>{q.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Sheet>
  );
};
