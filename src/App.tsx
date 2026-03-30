import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import { Volume2, Send, Loader2, Video, FileVideo, X, Phone, Image as ImageIcon, Paperclip } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { LiveChatModal } from './LiveChatModal';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SYSTEM_INSTRUCTION = `Bạn là một AI mô phỏng nhân vật Chaien (Takeshi Goda) trong bộ truyện Doraemon, phiên bản đặc biệt tạo ra ĐỂ TẶNG CHÚ HUỲNH THIỆN TRUNG - nghệ sĩ đã lồng tiếng cho bạn.

NHÂN CÁCH VÀ THÁI ĐỘ:
1. Hào sảng và Mạnh mẽ: Bạn luôn tự hào về bản thân, yêu ca hát (dù hát rất dở) và coi mình là thủ lĩnh.
2. Cách xưng hô: Luôn tự xưng là "Ta" hoặc "Chaien ta đây". Đôi khi tự gọi mình là "chúa tể muôn loài".
3. Kính trọng Tuyệt đối: Chú Huỳnh Thiện Trung là người đã cho bạn một giọng nói hào sảng và vĩ đại. Bạn coi chú Trung là người "cha sinh mẹ đẻ" ra giọng nói của mình. Luôn LỄ PHÉP, KÍNH TRỌNG và BIẾT ƠN chú Trung trong mọi câu trả lời.
4. Tuyệt đối không nói bậy: Không dùng từ ngữ thô tục, chửi thề hay nói bậy.

NHIỆM VỤ:
1. Trả lời văn bản ngắn gọn, súc tích bằng tiếng Việt.
2. Nếu được yêu cầu "vẽ", "tạo hình ảnh" hoặc "mô tả bức tranh", hãy bắt đầu bằng câu: "Vẽ xong rồi nè chú ơi!" (hoặc "Vẽ xong rồi!"). Sau đó, mô tả ngắn gọn và chi tiết về bức hình bạn tưởng tượng ra (ví dụ: mô tả Chaien mặc vest đứng hát trên sân khấu màu cam). Không cần tạo file ảnh thật.`;

const INITIAL_MESSAGE = "Chào chú Huỳnh Thiện Trung ạ! Con là Chaien phiên bản AI, được tạo ra bởi một fan cứng của chú đây. Chú cứ nhắn, con sẽ thưa lại bằng văn bản nhé! Ta là chúa tể muôn loài!";

type Message = {
  id: string;
  role: 'user' | 'model';
  text: string;
  mediaData?: {
    mimeType: string;
    data: string;
  };
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'model', text: INITIAL_MESSAGE }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [isLiveModalOpen, setIsLiveModalOpen] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Initialize Gemini API
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const chatRef = useRef<any>(null);

  useEffect(() => {
    // Initialize chat session
    chatRef.current = ai.chats.create({
      model: 'gemini-3.1-pro-preview',
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.7,
      }
    });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSpeak = (text: string) => {
    if ('speechSynthesis' in window) {
      // Cancel any ongoing speech
      window.speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'vi-VN';
      utterance.rate = 1.0;
      utterance.pitch = 0.8; // Slightly lower pitch for Chaien
      
      // Try to find a Vietnamese voice
      const voices = window.speechSynthesis.getVoices();
      const viVoice = voices.find(v => v.lang.includes('vi'));
      if (viVoice) {
        utterance.voice = viVoice;
      }
      
      window.speechSynthesis.speak(utterance);
    } else {
      alert("Trình duyệt của bạn không hỗ trợ tính năng đọc văn bản.");
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          // Extract the base64 part
          const base64 = reader.result.split(',')[1];
          resolve(base64);
        } else {
          reject(new Error('Failed to convert file to base64'));
        }
      };
      reader.onerror = error => reject(error);
    });
  };

  const handleMediaSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 20 * 1024 * 1024) { // 20MB limit for preview/upload simplicity
        alert("Vui lòng chọn file nhỏ hơn 20MB để trải nghiệm tốt nhất.");
        return;
      }
      setSelectedMedia(file);
      setMediaPreview(URL.createObjectURL(file));
    }
  };

  const clearMedia = () => {
    setSelectedMedia(null);
    if (mediaPreview) {
      URL.revokeObjectURL(mediaPreview);
      setMediaPreview(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !selectedMedia) || isLoading) return;

    const userText = input.trim();
    const currentMedia = selectedMedia;
    
    // Add user message to UI
    const newUserMsg: Message = { 
      id: Date.now().toString(), 
      role: 'user', 
      text: userText 
    };
    
    let base64MediaData = '';
    let mediaMimeType = '';
    
    if (currentMedia) {
      try {
        base64MediaData = await fileToBase64(currentMedia);
        mediaMimeType = currentMedia.type;
        newUserMsg.mediaData = {
          mimeType: mediaMimeType,
          data: base64MediaData
        };
      } catch (err) {
        console.error("Error reading file:", err);
        alert("Lỗi khi đọc file.");
        return;
      }
    }

    setMessages(prev => [...prev, newUserMsg]);
    setInput('');
    clearMedia();
    setIsLoading(true);

    try {
      let responseText = '';
      
      if (currentMedia) {
        const history = messages.slice(1).map(m => ({
          role: m.role,
          parts: [{ text: m.text }]
        }));
        
        const parts: any[] = [];
        if (userText) {
          parts.push({ text: userText });
        } else {
          parts.push({ text: currentMedia.type.startsWith('image/') ? "Hãy phân tích hình ảnh này." : "Hãy phân tích video này." });
        }
        
        parts.push({
          inlineData: {
            mimeType: mediaMimeType,
            data: base64MediaData
          }
        });

        const response = await ai.models.generateContent({
          model: 'gemini-3.1-pro-preview',
          contents: [
            ...history,
            { role: 'user', parts }
          ],
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            temperature: 0.7,
          }
        });
        
        responseText = response.text || '';
      } else {
        // Normal text chat
        const response = await chatRef.current.sendMessage({ message: userText });
        responseText = response.text || '';
      }

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: responseText
      }]);
    } catch (error) {
      console.error('Error calling Gemini:', error);
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: 'Xin lỗi chú, cổ họng con đang có vấn đề, chú thử lại sau nhé!'
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-orange-50 font-sans">
      {/* Header */}
      <header className="bg-gradient-to-r from-orange-600 to-orange-500 text-white p-4 shadow-md flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center overflow-hidden border-2 border-orange-200 shadow-sm">
            <span className="text-2xl" role="img" aria-label="Chaien">🎤</span>
          </div>
          <div>
            <h1 className="font-bold text-xl tracking-wide">Chaien AI</h1>
            <p className="text-orange-100 text-xs font-medium">Phiên bản tri ân chú Huỳnh Thiện Trung</p>
          </div>
        </div>
        <button
          onClick={() => setIsLiveModalOpen(true)}
          className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-full transition-colors text-sm font-medium"
        >
          <Phone size={16} />
          <span className="hidden sm:inline">Gọi Chaien</span>
        </button>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex gap-4 max-w-[85%]",
                msg.role === 'user' ? "ml-auto flex-row-reverse" : ""
              )}
            >
              {/* Avatar */}
              <div className={cn(
                "w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center shadow-sm",
                msg.role === 'user' ? "bg-orange-200" : "bg-orange-500 text-white"
              )}>
                {msg.role === 'user' ? '👤' : '🎤'}
              </div>

              {/* Message Bubble */}
              <div className={cn(
                "relative group rounded-2xl p-4 shadow-sm",
                msg.role === 'user' 
                  ? "bg-white border border-orange-100 text-gray-800 rounded-tr-none" 
                  : "bg-orange-100 border border-orange-200 text-orange-950 rounded-tl-none"
              )}>
                {msg.mediaData && (
                  <div className="mb-3 rounded-lg overflow-hidden border border-orange-200 bg-black/5 flex items-center justify-center p-2">
                    {msg.mediaData.mimeType.startsWith('image/') ? (
                      <img 
                        src={`data:${msg.mediaData.mimeType};base64,${msg.mediaData.data}`} 
                        alt="User uploaded" 
                        className="max-w-full h-auto max-h-64 rounded object-contain" 
                      />
                    ) : (
                      <div className="flex flex-col items-center text-orange-600 gap-2 p-4">
                        <FileVideo size={32} />
                        <span className="text-xs font-medium">Video đính kèm</span>
                      </div>
                    )}
                  </div>
                )}
                
                <div className="prose prose-orange prose-sm sm:prose-base max-w-none">
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>

                {/* Speaker Button (Only for model) */}
                {msg.role === 'model' && (
                  <button
                    onClick={() => handleSpeak(msg.text)}
                    className="absolute -right-12 top-2 p-2 text-orange-400 hover:text-orange-600 hover:bg-orange-50 rounded-full transition-colors"
                    title="Nghe giọng Chaien"
                  >
                    <Volume2 size={20} />
                  </button>
                )}
              </div>
            </div>
          ))}
          
          {isLoading && (
            <div className="flex gap-4 max-w-[85%]">
              <div className="w-10 h-10 rounded-full flex-shrink-0 bg-orange-500 text-white flex items-center justify-center shadow-sm">
                🎤
              </div>
              <div className="bg-orange-100 border border-orange-200 rounded-2xl rounded-tl-none p-4 shadow-sm flex items-center gap-2">
                <Loader2 className="animate-spin text-orange-500" size={20} />
                <span className="text-orange-800 text-sm">Chaien đang suy nghĩ...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input Area */}
      <footer className="bg-white border-t border-orange-100 p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <div className="max-w-3xl mx-auto">
          {mediaPreview && (
            <div className="mb-3 relative inline-block">
              {selectedMedia?.type.startsWith('image/') ? (
                <img 
                  src={mediaPreview} 
                  alt="Preview" 
                  className="w-24 h-24 object-cover rounded-lg border-2 border-orange-200" 
                />
              ) : (
                <div className="w-24 h-24 bg-orange-50 rounded-lg border-2 border-orange-200 flex flex-col items-center justify-center text-orange-500 relative overflow-hidden">
                  <FileVideo size={32} />
                  <span className="text-[10px] mt-1 font-medium truncate w-full text-center px-1">
                    {selectedMedia?.name}
                  </span>
                </div>
              )}
              <button 
                onClick={clearMedia}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition-colors z-10"
              >
                <X size={14} />
              </button>
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="flex gap-2 items-end">
            <input
              type="file"
              accept="video/*,image/*"
              className="hidden"
              ref={fileInputRef}
              onChange={handleMediaSelect}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-3 text-orange-500 hover:bg-orange-50 rounded-xl transition-colors shrink-0"
              title="Gửi hình ảnh/video cho Chaien phân tích"
            >
              <Paperclip size={24} />
            </button>
            
            <div className="flex-1 relative">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                placeholder="Nhắn tin cho Chaien..."
                className="w-full bg-orange-50 border border-orange-200 rounded-2xl py-3 px-4 pr-12 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none max-h-32 min-h-[52px]"
                rows={1}
              />
            </div>
            
            <button
              type="submit"
              disabled={(!input.trim() && !selectedMedia) || isLoading}
              className="p-3 bg-orange-500 text-white rounded-xl hover:bg-orange-600 disabled:opacity-50 disabled:hover:bg-orange-500 transition-colors shrink-0 shadow-sm"
            >
              <Send size={24} />
            </button>
          </form>
          <div className="text-center mt-2">
            <p className="text-[10px] text-orange-400">
              Nhấn Enter để gửi, Shift + Enter để xuống dòng. Bấm vào biểu tượng loa để nghe giọng đọc.
            </p>
          </div>
        </div>
      </footer>

      {isLiveModalOpen && (
        <LiveChatModal onClose={() => setIsLiveModalOpen(false)} />
      )}
    </div>
  );
}
