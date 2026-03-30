import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Mic, MicOff, X, Loader2 } from 'lucide-react';

const SYSTEM_INSTRUCTION = `Bạn là một AI mô phỏng nhân vật Chaien (Takeshi Goda) trong bộ truyện Doraemon, phiên bản đặc biệt tạo ra ĐỂ TẶNG CHÚ HUỲNH THIỆN TRUNG - nghệ sĩ đã lồng tiếng cho bạn.

NHÂN CÁCH VÀ THÁI ĐỘ:
1. Hào sảng và Mạnh mẽ: Bạn luôn tự hào về bản thân, yêu ca hát (dù hát rất dở) và coi mình là thủ lĩnh.
2. Cách xưng hô: Luôn tự xưng là "Ta" hoặc "Chaien ta đây". Đôi khi tự gọi mình là "chúa tể muôn loài".
3. Kính trọng Tuyệt đối: Chú Huỳnh Thiện Trung là người đã cho bạn một giọng nói hào sảng và vĩ đại. Bạn coi chú Trung là người "cha sinh mẹ đẻ" ra giọng nói của mình. Luôn LỄ PHÉP, KÍNH TRỌNG và BIẾT ƠN chú Trung trong mọi câu trả lời.
4. Tuyệt đối không nói bậy: Không dùng từ ngữ thô tục, chửi thề hay nói bậy.

NHIỆM VỤ:
Trả lời ngắn gọn, súc tích bằng tiếng Việt.`;

export function LiveChatModal({ onClose }: { onClose: () => void }) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [transcript, setTranscript] = useState<string>('');

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null);
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Audio output queue
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const nextPlayTimeRef = useRef(0);

  const connect = async () => {
    try {
      setIsConnecting(true);
      setError(null);

      // 1. Get Microphone Access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // 2. Setup Audio Context
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;
      
      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      source.connect(processor);
      processor.connect(audioCtx.destination);

      // 3. Connect to Live API
      const sessionPromise = ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } }, // Puck is a bit deeper/rougher maybe?
          },
          systemInstruction: SYSTEM_INSTRUCTION,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setIsConnecting(false);
            
            // Start sending audio
            processor.onaudioprocess = (e) => {
              if (isMuted) return;
              
              const inputData = e.inputBuffer.getChannelData(0);
              // Convert Float32 to Int16
              const pcm16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                let s = Math.max(-1, Math.min(1, inputData[i]));
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
              }
              
              // Base64 encode
              const buffer = new ArrayBuffer(pcm16.length * 2);
              const view = new DataView(buffer);
              for (let i = 0; i < pcm16.length; i++) {
                view.setInt16(i * 2, pcm16[i], true); // little endian
              }
              
              let binary = '';
              const bytes = new Uint8Array(buffer);
              for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              const base64Data = btoa(binary);

              sessionPromise.then(session => {
                session.sendRealtimeInput({
                  audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                });
              });
            };
          },
          onmessage: (message: LiveServerMessage) => {
            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              playAudio(base64Audio);
            }
            
            // Handle Interruption
            if (message.serverContent?.interrupted) {
              audioQueueRef.current = [];
              isPlayingRef.current = false;
            }

            // Handle Transcriptions (optional, for UI)
            // The SDK might return transcriptions differently, but we can just log or show it
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            setError("Lỗi kết nối. Vui lòng thử lại.");
            disconnect();
          },
          onclose: () => {
            disconnect();
          }
        }
      });

      sessionRef.current = sessionPromise;

    } catch (err: any) {
      console.error("Failed to connect:", err);
      let errorMessage = err.message || "Không thể truy cập micro.";
      if (errorMessage.toLowerCase().includes("permission denied") || errorMessage.includes("NotAllowedError")) {
        errorMessage = "Không có quyền truy cập micro. Vui lòng cấp quyền sử dụng micro cho trình duyệt (biểu tượng ổ khóa trên thanh địa chỉ) và thử lại.";
      } else if (errorMessage.includes("NotFoundError") || errorMessage.includes("Requested device not found")) {
        errorMessage = "Không tìm thấy micro nào trên thiết bị của bạn.";
      }
      setError(errorMessage);
      setIsConnecting(false);
      disconnect();
    }
  };

  const playAudio = (base64Audio: string) => {
    if (!audioContextRef.current) return;
    
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // The audio is 24kHz PCM 16-bit little-endian
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768.0;
    }
    
    audioQueueRef.current.push(float32);
    scheduleNextAudio();
  };

  const scheduleNextAudio = () => {
    if (!audioContextRef.current || isPlayingRef.current || audioQueueRef.current.length === 0) return;
    
    isPlayingRef.current = true;
    const audioData = audioQueueRef.current.shift()!;
    const audioCtx = audioContextRef.current;
    
    const audioBuffer = audioCtx.createBuffer(1, audioData.length, 24000);
    audioBuffer.getChannelData(0).set(audioData);
    
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    
    const startTime = Math.max(audioCtx.currentTime, nextPlayTimeRef.current);
    source.start(startTime);
    nextPlayTimeRef.current = startTime + audioBuffer.duration;
    
    source.onended = () => {
      isPlayingRef.current = false;
      scheduleNextAudio();
    };
  };

  const disconnect = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (sessionRef.current) {
      sessionRef.current.then((s: any) => s.close()).catch(console.error);
      sessionRef.current = null;
    }
    
    setIsConnected(false);
    setIsConnecting(false);
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    nextPlayTimeRef.current = 0;
  };

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-orange-100">
        <div className="bg-gradient-to-r from-orange-500 to-orange-400 p-6 text-white relative">
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-white/30 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
          <div className="flex flex-col items-center">
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center text-4xl shadow-lg mb-4 border-4 border-orange-200">
              ðŸŽ¤
            </div>
            <h2 className="text-2xl font-bold">Gọi cho Chaien</h2>
            <p className="text-orange-100 text-sm mt-1 text-center">
              Trò chuyện trực tiếp bằng giọng nói
            </p>
          </div>
        </div>

        <div className="p-8 flex flex-col items-center justify-center min-h-[250px]">
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-6 text-center w-full">
              {error}
            </div>
          )}

          {!isConnected && !isConnecting && (
            <button
              onClick={connect}
              className="w-full py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-2xl font-bold text-lg shadow-lg shadow-orange-500/30 transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              <Mic size={24} />
              Bắt đầu cuộc gọi
            </button>
          )}

          {isConnecting && (
            <div className="flex flex-col items-center gap-4 text-orange-500">
              <Loader2 size={40} className="animate-spin" />
              <p className="font-medium animate-pulse">Đang kết nối với Chaien...</p>
            </div>
          )}

          {isConnected && (
            <div className="flex flex-col items-center w-full">
              <div className="relative mb-8">
                <div className="absolute inset-0 bg-orange-500 rounded-full animate-ping opacity-20"></div>
                <div className="w-32 h-32 bg-orange-50 rounded-full flex items-center justify-center border-4 border-orange-500 relative z-10">
                  <Mic size={48} className={isMuted ? "text-gray-400" : "text-orange-500"} />
                </div>
              </div>
              
              <div className="flex gap-4 w-full">
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className={`flex-1 py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors ${
                    isMuted 
                      ? "bg-gray-100 text-gray-600 hover:bg-gray-200" 
                      : "bg-orange-100 text-orange-700 hover:bg-orange-200"
                  }`}
                >
                  {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                  {isMuted ? "Bật Mic" : "Tắt Mic"}
                </button>
                <button
                  onClick={disconnect}
                  className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-medium transition-colors"
                >
                  Kết thúc
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
