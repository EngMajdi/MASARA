import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, Loader2, X, Sparkles, Bus, PhoneCall, UserCheck, Clock } from 'lucide-react';

interface AdvisorModalProps {
  onClose: () => void;
  onAskAdvisor: (query: string) => Promise<string>;
}

// Helper to render bold text & markdown line breaks nicely
const FormattedText: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split('\n');

  return (
    <div className="space-y-1">
      {lines.map((line, lIdx) => {
        if (!line.trim()) return <div key={lIdx} className="h-1.5" />;

        // Parse **bold** parts
        const parts = line.split(/(\*\*.*?\*\*)/g);

        return (
          <p key={lIdx} className="leading-relaxed">
            {parts.map((part, pIdx) => {
              if (part.startsWith('**') && part.endsWith('**')) {
                return (
                  <strong key={pIdx} className="font-bold text-amber-300">
                    {part.slice(2, -2)}
                  </strong>
                );
              }
              return part;
            })}
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
      text: `مرحباً بك في **مساعد مَسارَا الذكي (MASARA AI Assistant)**! 🚌✨

أنا متصل مباشرة ببيانات الأسطول والطلاب والتتبع الحي. يمكنك سؤالي عن أي شيء مثل:
• **"أين الباص ومتى يصل؟"**
• **"هل صعد الطالب الخليل البوسعيدي الحافلة؟"**
• **"ما هو رقم هاتف السائق؟"**`
    }
  ]);

  const quickQuestions = [
    { label: 'أين حافلة 101 ومتى الوقت المحدد للوصول؟', icon: Bus },
    { label: 'هل صعدت مريم البوسعيدية الحافلة؟', icon: UserCheck },
    { label: 'ما هي حالة الطالب الخليل البوسعيدي؟', icon: Clock },
    { label: 'ما هو رقم هاتف سائق الحافلة؟', icon: PhoneCall }
  ];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
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
      setMessages((prev) => [
        ...prev,
        { sender: 'ai', text: 'عذراً، حدث خطأ أثناء معالجة الاستفسار. يرجى المحاولة مرة أخرى.' }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSend(query);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 font-['Tajawal',sans-serif]">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-6 max-w-2xl w-full shadow-2xl relative my-auto z-10 max-h-[92vh] flex flex-col animate-fade-in text-white">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3.5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-gradient-to-tr from-amber-500/20 to-amber-400/20 text-amber-300 rounded-2xl border border-amber-500/30 shrink-0 shadow-xs">
              <Bot className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-base text-white flex items-center gap-1.5">
                <span>مساعد مَسارَا الذكي الشامل</span>
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              </h3>
              <p className="text-[10px] text-slate-400 font-medium">
                متصل مباشرة بالتتبع الحي للأسطول والطلاب (GPS Live Context)
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="text-slate-400 hover:text-white transition-colors p-2 rounded-xl hover:bg-white/10 cursor-pointer"
            title="إغلاق النافذة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Messages List Area */}
        <div className="space-y-3.5 flex-1 overflow-y-auto py-4 pr-1 text-xs">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`p-3.5 sm:p-4 rounded-2xl max-w-[90%] leading-relaxed shadow-sm ${
                msg.sender === 'user'
                  ? 'bg-blue-600 text-white mr-auto rounded-tl-none font-medium'
                  : 'bg-slate-950 border border-slate-800/90 text-slate-200 ml-auto rounded-tr-none'
              }`}
            >
              <FormattedText text={msg.text} />
            </div>
          ))}

          {loading && (
            <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 text-amber-300 flex items-center gap-2 text-xs animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
              <span>جاري الاستعلام وقراءة البيانات الحية للأسطول والطلاب...</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Suggestion Chips */}
        <div className="py-2 border-t border-slate-800/80 shrink-0">
          <p className="text-[10px] font-bold text-slate-400 mb-1.5 flex items-center gap-1">
            <span>أسئلة شائعة وسريعة:</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {quickQuestions.map((q, qIdx) => {
              const IconComponent = q.icon;
              return (
                <button
                  key={qIdx}
                  type="button"
                  onClick={() => handleSend(q.label)}
                  disabled={loading}
                  className="bg-slate-950/80 hover:bg-slate-800 text-slate-300 hover:text-amber-300 px-2.5 py-1 rounded-lg border border-slate-800 text-[11px] font-medium transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <IconComponent className="w-3 h-3 text-amber-400 shrink-0" />
                  <span>{q.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="flex gap-2 pt-2.5 border-t border-slate-800 shrink-0">
          <input
            type="text"
            placeholder="اكتب سؤالك (مثال: أين الباص؟ كم ETA؟ أين ابني؟ رقم السائق؟)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 font-medium"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 shadow disabled:opacity-50 transition-all shrink-0 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>إرسال</span>
          </button>
        </form>

      </div>
    </div>
  );
};
