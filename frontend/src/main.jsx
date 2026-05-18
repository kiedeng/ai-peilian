import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Bot,
  CalendarClock,
  Check,
  ClipboardList,
  Clock3,
  FileCheck2,
  FileText,
  Headphones,
  ImagePlus,
  Layers3,
  LogOut,
  Mic,
  Pause,
  Play,
  Plus,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  Volume2,
} from 'lucide-react';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8010';
const TOKEN_KEY = 'ai-peilian-token';
const DEFAULT_TTS_VOICE = '杜小雯';
const DEFAULT_VOICE_SETTINGS = { voice: DEFAULT_TTS_VOICE, speed: 1, auto_play: true, default_input_mode: 'voice', continuous_voice: true };
const VAD_CONFIG = { threshold: 0.035, startMs: 260, silenceMs: 1500, minSpeechMs: 650, maxDurationMs: 24000 };
const LEGACY_OPENAI_VOICES = new Set(['alloy', 'echo', 'nova', 'shimmer']);

const backgroundPresets = [
  ['aurora', '晨光蓝', 'linear-gradient(135deg, #eef6ff 0%, #f8fbff 45%, #e8fff7 100%)'],
  ['finance', '金融绿', 'linear-gradient(135deg, #ecfdf3 0%, #f8fafc 48%, #eef4ff 100%)'],
  ['city', '城市灰', 'linear-gradient(135deg, #f1f5f9 0%, #ffffff 42%, #e2e8f0 100%)'],
  ['slate', '深海蓝', 'linear-gradient(135deg, #102033 0%, #1f3b57 54%, #d7e6ff 100%)'],
];

const scriptTypes = [
  ['standard', '标准话术'],
  ['question', '引导问题'],
  ['forbidden', '禁用表达'],
  ['knowledge', '知识点'],
  ['compliance', '合规红线'],
  ['objection_handling', '异议处理'],
];

const scriptStages = [
  ['any', '全阶段'],
  ['opening', '开场'],
  ['needs', '需求挖掘'],
  ['explain', '产品解释'],
  ['objection', '异议处理'],
  ['compliance', '合规确认'],
  ['closing', '收尾推进'],
];

const steps = ['场景配置', '话术配置', '评分维度', '体验发布'];
const reportStatusText = {
  pending_ai: 'AI 自动评分中',
  pending_review: '待复核（历史）',
  approved: '已自动发布',
  returned: '已退回',
  failed: '评分失败',
};

const emptyPersona = {
  customer_name: '',
  gender: '',
  age: '',
  identity: '',
  background: '',
  target: '',
  personality: '',
  objections: [],
  risk_preference: '',
  difficulty: 'medium',
};

function emptyActivity() {
  const now = new Date();
  const nextMonth = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  return {
    title: '',
    description: '',
    training_goal: '',
    average_minutes: 15,
    opening_line: '',
    entry_description: '',
    chat_background_type: 'preset',
    chat_background_value: 'aurora',
    chat_background_overlay: 0.42,
    voice_settings: { ...DEFAULT_VOICE_SETTINGS },
    status: 'draft',
    starts_at: toDatetimeLocal(now),
    ends_at: toDatetimeLocal(nextMonth),
    persona: { ...emptyPersona },
    script_items: [],
    dimensions: [
      makeDimension('开场与信任建立', 10, 0),
      makeDimension('需求挖掘', 20, 1),
      makeDimension('产品解释准确性', 20, 2),
      makeDimension('合规表达', 25, 3),
      makeDimension('异议处理', 15, 4),
      makeDimension('推进与服务礼仪', 10, 5),
    ],
  };
}

function makeScript(type = 'standard', sort = 0) {
  return { item_type: type, stage: 'any', intent_tags: [], risk_tags: [], priority: 50, enabled: true, title: '', content: '', sort_order: sort };
}

function makeDimension(name = '', weight = 10, sort = 0) {
  return { name, weight, scoring_criteria: '', deduction_rules: [], improvement_advice: '', risk_triggers: [], sort_order: sort };
}

function toDatetimeLocal(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromApiActivity(activity) {
  return {
    ...activity,
    chat_background_type: activity.chat_background_type || 'preset',
    chat_background_value: activity.chat_background_value || 'aurora',
    chat_background_overlay: activity.chat_background_overlay ?? 0.42,
    voice_settings: normalizeVoiceSettings(activity.voice_settings),
    starts_at: activity.starts_at ? toDatetimeLocal(new Date(activity.starts_at)) : '',
    ends_at: activity.ends_at ? toDatetimeLocal(new Date(activity.ends_at)) : '',
    persona: activity.persona || { ...emptyPersona },
    script_items: (activity.script_items || []).map((item, index) => ({
      stage: 'any',
      intent_tags: [],
      risk_tags: [],
      priority: 50,
      enabled: true,
      sort_order: index,
      ...item,
    })),
    dimensions: activity.dimensions || [],
  };
}

function normalizeVoiceSettings(settings = {}) {
  const voiceSettings = { ...DEFAULT_VOICE_SETTINGS, ...settings };
  if (LEGACY_OPENAI_VOICES.has(voiceSettings.voice)) voiceSettings.voice = DEFAULT_TTS_VOICE;
  if (!['text', 'voice'].includes(voiceSettings.default_input_mode)) voiceSettings.default_input_mode = 'voice';
  voiceSettings.continuous_voice = voiceSettings.continuous_voice !== false;
  return voiceSettings;
}

function normalizeActivity(activity) {
  return { ...activity, voice_settings: normalizeVoiceSettings(activity.voice_settings) };
}

function toApiActivity(activity, status = activity.status) {
  return {
    ...activity,
    status,
    average_minutes: Number(activity.average_minutes || 15),
    chat_background_overlay: Number(activity.chat_background_overlay ?? 0.42),
    starts_at: activity.starts_at ? new Date(activity.starts_at).toISOString() : null,
    ends_at: activity.ends_at ? new Date(activity.ends_at).toISOString() : null,
    persona: { ...activity.persona, age: activity.persona.age ? Number(activity.persona.age) : null },
    script_items: activity.script_items.map((item, index) => ({ ...item, sort_order: index })),
    dimensions: activity.dimensions.map((item, index) => ({ ...item, weight: Number(item.weight || 0), sort_order: index })),
  };
}

function splitLines(value) {
  return String(value || '').split('\n').map((item) => item.trim()).filter(Boolean);
}

function joinLines(value) {
  return (value || []).join('\n');
}

function createWavBlob(chunks, sampleRate) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const samples = new Float32Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    samples.set(chunk, offset);
    offset += chunk.length;
  });

  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let dataOffset = 44;
  for (const sample of samples) {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(dataOffset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
    dataOffset += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

async function createWavRecorder(stream, options = {}) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('当前浏览器不支持录音编码，请使用文字输入。');
  const audioContext = new AudioContextClass();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  const preSpeechChunks = [];
  const threshold = options.threshold ?? VAD_CONFIG.threshold;
  const startMs = options.startMs ?? VAD_CONFIG.startMs;
  const silenceMs = options.silenceMs ?? VAD_CONFIG.silenceMs;
  const minSpeechMs = options.minSpeechMs ?? VAD_CONFIG.minSpeechMs;
  const maxDurationMs = options.maxDurationMs ?? VAD_CONFIG.maxDurationMs;
  let speechStarted = false;
  let potentialSpeechAt = 0;
  let lastSpeechAt = Date.now();
  let speechStartedAt = 0;
  let stopping = false;
  processor.onaudioprocess = (event) => {
    const channel = event.inputBuffer.getChannelData(0);
    const frame = new Float32Array(channel);
    if (!options.vad) {
      chunks.push(frame);
      return;
    }
    let sum = 0;
    for (let index = 0; index < channel.length; index += 1) sum += channel[index] * channel[index];
    const level = Math.sqrt(sum / channel.length);
    options.onLevel?.(level);
    const now = Date.now();
    if (level >= threshold) {
      lastSpeechAt = now;
      if (!potentialSpeechAt) potentialSpeechAt = now;
      if (!speechStarted && now - potentialSpeechAt >= startMs) {
        speechStarted = true;
        speechStartedAt = potentialSpeechAt;
        chunks.push(...preSpeechChunks);
        preSpeechChunks.length = 0;
        options.onSpeechStart?.();
      }
    } else if (!speechStarted) {
      potentialSpeechAt = 0;
    }
    if (speechStarted) {
      chunks.push(frame);
    } else {
      preSpeechChunks.push(frame);
      if (preSpeechChunks.length > 8) preSpeechChunks.shift();
    }
    if (speechStarted && !stopping && ((now - lastSpeechAt >= silenceMs && now - speechStartedAt >= minSpeechMs) || now - speechStartedAt >= maxDurationMs)) {
      stopping = true;
      options.onSilenceEnd?.();
    }
  };
  source.connect(processor);
  processor.connect(audioContext.destination);

  return {
    async stop() {
      stopping = true;
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      await audioContext.close();
      return createWavBlob(chunks, audioContext.sampleRate);
    },
  };
}

function authHeaders(extra = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

async function api(path, options = {}) {
  const headers = options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' };
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: authHeaders({ ...headers, ...(options.headers || {}) }) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `请求失败：${response.status}`);
  }
  return response.json();
}

function assetUrl(value) {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `${API_BASE}${value}`;
}

function isLocalHost(hostname) {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

function backgroundStyle(activity) {
  const type = activity?.chat_background_type || 'preset';
  const value = activity?.chat_background_value || 'aurora';
  if (type === 'preset') {
    return { background: backgroundPresets.find(([key]) => key === value)?.[2] || backgroundPresets[0][2] };
  }
  return { backgroundImage: `url("${assetUrl(value)}")` };
}

function useToast() {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  function show(message, kind = 'error', duration = 3400) {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ message, kind });
    timerRef.current = window.setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, duration);
  }

  function hide() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(null);
  }

  const toastEl = toast
    ? <FloatingToast message={toast.message} kind={toast.kind} onClose={hide} />
    : null;

  return { toast, show, hide, toastEl };
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage mode="student" />} />
        <Route path="/admin/login" element={<LoginPage mode="admin" />} />
        <Route path="/admin/activities" element={<AdminGuard><AdminActivities /></AdminGuard>} />
        <Route path="/admin/activities/:id/edit" element={<AdminGuard><ActivityEditor /></AdminGuard>} />
        <Route path="/admin/reviews" element={<AdminGuard><ReviewQueue /></AdminGuard>} />
        <Route path="/admin/reviews/:id" element={<AdminGuard><ReviewDetail /></AdminGuard>} />
        <Route path="/admin/analytics" element={<AdminGuard><AnalyticsPage /></AdminGuard>} />
        <Route path="/activities" element={<UserGuard><ActivityList /></UserGuard>} />
        <Route path="/activities/:id/practice" element={<UserGuard><PracticePage /></UserGuard>} />
        <Route path="/activities/:id/practice/submitted" element={<UserGuard><PracticeSubmittedPage /></UserGuard>} />
        <Route path="/reports" element={<UserGuard><MyReports /></UserGuard>} />
        <Route path="/reports/:id" element={<UserGuard><MyReportDetail /></UserGuard>} />
        <Route path="/" element={<Navigate to="/activities" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function LoginPage({ mode }) {
  const navigate = useNavigate();
  const { toast, show } = useToast();
  const [form, setForm] = useState({ username: mode === 'admin' ? 'admin' : 'student', password: mode === 'admin' ? 'admin123' : 'student123' });
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api('/api/auth/providers').then(setProviders).catch(() => setProviders([]));
  }, []);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    try {
      const payload = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(form) });
      localStorage.setItem(TOKEN_KEY, payload.token);
      navigate(payload.user.role === 'admin' ? '/admin/activities' : '/activities');
    } catch (error) {
      show(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function enterpriseLogin(provider) {
    try {
      const result = await api(`/api/auth/oauth/${provider.key}/authorize`);
      if (!result.enabled) {
        show(result.detail || '企业登录尚未配置');
        return;
      }
      window.location.href = result.url;
    } catch (error) {
      show(error.message);
    }
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="brand-mark"><ShieldCheck size={30} /></div>
        <span className="eyebrow">Enterprise AI Coaching</span>
        <h1>信贷 AI 陪练工作台</h1>
        <p>围绕企业身份、沉浸式语音陪练、AI 自动评分和运营分析构建的训练平台。</p>
        <div className="login-metrics">
          <span><b>OAuth</b> 企业身份预留</span>
          <span><b>Voice</b> 语音陪练</span>
          <span><b>QA</b> 自动评分</span>
        </div>
      </section>
      <form className="login-card" onSubmit={submit}>
        <span className="eyebrow">{mode === 'admin' ? '管理后台' : '学员入口'}</span>
        <h2>{mode === 'admin' ? '运营与质检登录' : '进入训练中心'}</h2>
        <label>用户名</label>
        <input aria-label="用户名" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
        <label>密码</label>
        <input aria-label="密码" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        <button className="primary" disabled={loading}>{loading ? '登录中...' : '本地账号登录'}</button>
        <div className="enterprise-login">
          <b>企业账号登录</b>
          {(providers.length ? providers : [{ key: 'enterprise', name: '企业账号', enabled: false }]).map((provider) => (
            <button type="button" key={provider.key} onClick={() => enterpriseLogin(provider)} className="outline-button full">
              <ShieldCheck size={16} /> {provider.name}{provider.enabled ? '' : '（待配置）'}
            </button>
          ))}
        </div>
        <Link to={mode === 'admin' ? '/login' : '/admin/login'}>{mode === 'admin' ? '切换到学员入口' : '切换到管理后台'}</Link>
        {toast && <Notice message={toast.message} kind={toast.kind} />}
      </form>
    </div>
  );
}

function AdminGuard({ children }) {
  return <Guard role="admin" loginPath="/admin/login">{children}</Guard>;
}

function UserGuard({ children }) {
  return <Guard loginPath="/login">{children}</Guard>;
}

function Guard({ children, role, loginPath }) {
  const [state, setState] = useState({ loading: true, user: null });
  useEffect(() => {
    api('/api/auth/me').then((user) => setState({ loading: false, user })).catch(() => setState({ loading: false, user: null }));
  }, []);
  if (state.loading) return <div className="page-loading">正在加载系统...</div>;
  if (!state.user) return <Navigate to={loginPath} replace />;
  if (role && state.user.role !== role) return <Navigate to="/activities" replace />;
  return children;
}

function TopNav({ userSide = false }) {
  const navigate = useNavigate();
  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    navigate(userSide ? '/login' : '/admin/login');
  }
  return (
    <header className="top-nav">
      <Link className="brand-link" to={userSide ? '/activities' : '/admin/activities'}>
        <ShieldCheck size={24} />
        <span>AI 陪练</span>
      </Link>
      <nav>
        {userSide ? (
          <>
            <Link to="/activities">训练中心</Link>
            <Link to="/reports">我的报告</Link>
          </>
        ) : (
          <>
            <Link to="/admin/activities">活动管理</Link>
            <Link to="/admin/reviews">质检中心</Link>
            <Link to="/admin/analytics">数据看板</Link>
            <Link to="/activities">学员端</Link>
          </>
        )}
        <button className="text-button" onClick={logout}><LogOut size={16} /> 退出</button>
      </nav>
    </header>
  );
}

function AdminActivities() {
  const navigate = useNavigate();
  const { toast, show } = useToast();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { refresh(); }, []);

  async function refresh() {
    try {
      setActivities(await api('/api/admin/activities'));
    } catch (error) {
      show(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    try {
      const activity = await api('/api/admin/activities', { method: 'POST', body: JSON.stringify(toApiActivity(emptyActivity())) });
      navigate(`/admin/activities/${activity.id}/edit`);
    } catch (error) {
      show(error.message);
    }
  }

  async function remove(id) {
    if (!window.confirm('确定删除这个活动吗？')) return;
    await api(`/api/admin/activities/${id}`, { method: 'DELETE' });
    refresh();
  }

  return (
    <AdminShell>
      <div className="page-title">
        <div>
          <span className="eyebrow">Operation Console</span>
          <h1>活动管理</h1>
          <p>配置场景、人设、话术、评分和语音体验。</p>
        </div>
        <button className="primary compact" onClick={create}><Plus size={18} /> 新建活动</button>
      </div>
      {toast && <Notice message={toast.message} kind={toast.kind} />}
      <div className="table-card">
        <table>
          <thead>
            <tr><th>活动</th><th>状态</th><th>有效期</th><th>训练时长</th><th>操作</th></tr>
          </thead>
          <tbody>
            {activities.map((item) => (
              <tr key={item.id}>
                <td data-label="活动"><b>{item.title}</b><span>{item.description || '暂无描述'}</span></td>
                <td data-label="状态"><StatusBadge status={item.status} /></td>
                <td data-label="有效期">{formatDate(item.starts_at)} - {formatDate(item.ends_at)}</td>
                <td data-label="训练时长">{item.average_minutes} 分钟</td>
                <td data-label="操作" className="actions">
                  <button onClick={() => navigate(`/admin/activities/${item.id}/edit`)}>编辑</button>
                  <button onClick={() => remove(item.id)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !activities.length && <div className="empty">暂无活动，先新建一个发布配置。</div>}
      </div>
    </AdminShell>
  );
}

function ActivityEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, show, toastEl } = useToast();
  const [activeStep, setActiveStep] = useState(0);
  const [activity, setActivity] = useState(null);
  const [saving, setSaving] = useState(false);
  const totalWeight = useMemo(() => (activity?.dimensions || []).reduce((sum, item) => sum + Number(item.weight || 0), 0), [activity]);

  useEffect(() => {
    api(`/api/admin/activities/${id}`).then((data) => setActivity(fromApiActivity(data))).catch((error) => show(error.message));
  }, [id]);

  if (!activity) return <div className="page-loading">正在加载配置...</div>;

  async function save(status = activity.status) {
    setSaving(true);
    try {
      const saved = await api(`/api/admin/activities/${id}`, { method: 'PUT', body: JSON.stringify(toApiActivity(activity, status)) });
      setActivity(fromApiActivity(saved));
      show('配置已保存', 'success', 2000);
    } catch (error) {
      show(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    await save('draft');
    try {
      const saved = await api(`/api/admin/activities/${id}/publish`, { method: 'POST' });
      setActivity(fromApiActivity(saved));
      show('活动已发布', 'success', 2000);
    } catch (error) {
      show(error.message);
    }
  }

  return (
    <AdminShell wide>
      {toastEl}
      <button className="back-button" onClick={() => navigate('/admin/activities')}><ArrowLeft size={16} /> 返回活动列表</button>
      <div className="editor-header">
        <div>
          <span className="eyebrow">Activity Setup</span>
          <h1>{activity.title || '未命名活动'}</h1>
        </div>
        <StatusBadge status={activity.status} />
      </div>
      <StepBar active={activeStep} setActive={setActiveStep} />
      <section className="wizard-card">
        {activeStep === 0 && <PersonaStep activity={activity} setActivity={setActivity} show={show} />}
        {activeStep === 1 && <ScriptStep activity={activity} setActivity={setActivity} />}
        {activeStep === 2 && <DimensionStep activity={activity} setActivity={setActivity} totalWeight={totalWeight} />}
        {activeStep === 3 && <PublishStep activity={activity} setActivity={setActivity} totalWeight={totalWeight} show={show} />}
        <div className="wizard-actions">
          <button disabled={activeStep === 0} onClick={() => setActiveStep(activeStep - 1)}>上一步</button>
          <button disabled={activeStep === steps.length - 1} onClick={() => setActiveStep(activeStep + 1)}>下一步</button>
          <button className="primary compact" disabled={saving} onClick={() => save()}><Save size={17} /> 保存</button>
          <button className="publish-button" disabled={saving} onClick={publish}><Check size={17} /> 发布活动</button>
        </div>
      </section>
    </AdminShell>
  );
}

function StepBar({ active, setActive }) {
  return (
    <div className="step-bar">
      {steps.map((step, index) => (
        <button className={active === index ? 'active' : ''} key={step} onClick={() => setActive(index)}>
          <span>{index + 1}</span>{step}
        </button>
      ))}
    </div>
  );
}

function PersonaStep({ activity, setActivity, show }) {
  const persona = activity.persona;
  const [scenePrompt, setScenePrompt] = useState('');
  const [generatedScene, setGeneratedScene] = useState(null);
  const [generating, setGenerating] = useState(false);
  const update = (patch) => setActivity({ ...activity, ...patch });
  const updatePersona = (patch) => setActivity({ ...activity, persona: { ...persona, ...patch } });

  async function generateScene() {
    const prompt = scenePrompt.trim();
    if (!prompt || generating) return;
    setGenerating(true);
    try {
      setGeneratedScene(await api('/api/admin/activities/generate-scene', { method: 'POST', body: JSON.stringify({ prompt }) }));
      show('场景草稿已生成', 'success');
    } catch (error) {
      show(error.message);
    } finally {
      setGenerating(false);
    }
  }

  function applyGeneratedScene() {
    if (!generatedScene) return;
    setActivity({
      ...activity,
      title: generatedScene.title || activity.title,
      description: generatedScene.description || activity.description,
      training_goal: generatedScene.training_goal || activity.training_goal,
      average_minutes: generatedScene.average_minutes || activity.average_minutes,
      opening_line: generatedScene.opening_line || activity.opening_line,
      entry_description: generatedScene.entry_description || activity.entry_description,
      persona: { ...emptyPersona, ...(generatedScene.persona || {}) },
    });
    setGeneratedScene(null);
    show('已应用生成配置', 'success');
  }

  return (
    <div className="form-grid">
      <div className="ai-generate-panel">
        <div>
          <b><Sparkles size={17} /> 一句话生成场景和人设</b>
          <p>输入训练需求，先生成草稿预览，确认后再应用到表单。</p>
        </div>
        <textarea value={scenePrompt} onChange={(event) => setScenePrompt(event.target.value)} placeholder="例如：生成一个小微企业主咨询经营贷、担心审批和综合费用的首次接待场景" />
        <button className="primary compact" onClick={generateScene} disabled={generating || !scenePrompt.trim()}><Sparkles size={16} /> {generating ? '生成中...' : '生成配置'}</button>
      </div>
      {generatedScene && (
        <div className="scene-preview">
          <div className="scene-preview-head">
            <b>生成草稿预览</b>
            <button className="primary compact" onClick={applyGeneratedScene}><Check size={16} /> 应用到表单</button>
          </div>
          <div className="scene-preview-grid">
            <span>活动标题</span><p>{generatedScene.title || '-'}</p>
            <span>训练目标</span><p>{generatedScene.training_goal || '-'}</p>
            <span>开场语</span><p>{generatedScene.opening_line || '-'}</p>
            <span>客户人设</span><p>{generatedScene.persona?.customer_name || 'AI 客户'} · {generatedScene.persona?.identity || '-'} · {generatedScene.persona?.difficulty || 'medium'}</p>
            <span>客户背景</span><p>{generatedScene.persona?.background || '-'}</p>
            <span>常见异议</span><p>{(generatedScene.persona?.objections || []).join('；') || '-'}</p>
          </div>
        </div>
      )}
      <SectionTitle icon={<ClipboardList />} title="活动场景" />
      <Field label="活动标题" value={activity.title} onChange={(value) => update({ title: value })} required />
      <Field label="活动描述" value={activity.description} onChange={(value) => update({ description: value })} textarea />
      <Field label="训练目标" value={activity.training_goal} onChange={(value) => update({ training_goal: value })} textarea />
      <Field label="平均训练时长（分钟）" type="number" value={activity.average_minutes} onChange={(value) => update({ average_minutes: value })} />
      <Field label="AI 客户开场语" value={activity.opening_line} onChange={(value) => update({ opening_line: value })} textarea required />
      <SectionTitle icon={<UserRound />} title="AI 客户人设" />
      <Field label="客户姓名" value={persona.customer_name} onChange={(value) => updatePersona({ customer_name: value })} />
      <Field label="性别" value={persona.gender} onChange={(value) => updatePersona({ gender: value })} />
      <Field label="年龄" type="number" value={persona.age || ''} onChange={(value) => updatePersona({ age: value })} />
      <Field label="客户身份" value={persona.identity} onChange={(value) => updatePersona({ identity: value })} />
      <Field label="客户背景" value={persona.background} onChange={(value) => updatePersona({ background: value })} textarea />
      <Field label="客户目标" value={persona.target} onChange={(value) => updatePersona({ target: value })} textarea />
      <Field label="性格特点" value={persona.personality} onChange={(value) => updatePersona({ personality: value })} textarea />
      <Field label="风险偏好" value={persona.risk_preference} onChange={(value) => updatePersona({ risk_preference: value })} textarea />
      <Field label="常见异议（一行一个）" value={joinLines(persona.objections)} onChange={(value) => updatePersona({ objections: splitLines(value) })} textarea />
      <label className="field"><span>难度</span><select value={persona.difficulty} onChange={(event) => updatePersona({ difficulty: event.target.value })}><option value="easy">简单</option><option value="medium">中等</option><option value="hard">困难</option></select></label>
    </div>
  );
}

function ScriptStep({ activity, setActivity }) {
  function add(type) {
    setActivity({ ...activity, script_items: [...activity.script_items, makeScript(type, activity.script_items.length)] });
  }
  function update(index, patch) {
    const next = [...activity.script_items];
    next[index] = { ...next[index], ...patch };
    setActivity({ ...activity, script_items: next });
  }
  function remove(index) {
    setActivity({ ...activity, script_items: activity.script_items.filter((_, itemIndex) => itemIndex !== index) });
  }
  return (
    <div>
      <SectionTitle icon={<Layers3 />} title="话术与规则库" />
      <div className="script-type-buttons">
        {scriptTypes.map(([type, label]) => <button key={type} onClick={() => add(type)}><Plus size={16} /> {label}</button>)}
      </div>
      <div className="config-table">
        <div className="config-row script-row header"><span>类型/阶段</span><span>标题/标签</span><span>内容</span><span>召回</span><span>操作</span></div>
        {activity.script_items.map((item, index) => (
          <div className="config-row script-row" key={index}>
            <div className="stacked-controls">
              <select value={item.item_type} onChange={(event) => update(index, { item_type: event.target.value })}>{scriptTypes.map(([type, label]) => <option value={type} key={type}>{label}</option>)}</select>
              <select value={item.stage || 'any'} onChange={(event) => update(index, { stage: event.target.value })}>{scriptStages.map(([stage, label]) => <option value={stage} key={stage}>{label}</option>)}</select>
            </div>
            <div className="stacked-controls">
              <input value={item.title} onChange={(event) => update(index, { title: event.target.value })} placeholder="例如：合规说明" />
              <input value={joinLines(item.intent_tags || [])} onChange={(event) => update(index, { intent_tags: splitLines(event.target.value) })} placeholder="意图标签，一行一个" />
              <input value={joinLines(item.risk_tags || [])} onChange={(event) => update(index, { risk_tags: splitLines(event.target.value) })} placeholder="风险标签，一行一个" />
            </div>
            <textarea value={item.content} onChange={(event) => update(index, { content: event.target.value })} placeholder="输入话术、问题或红线规则" />
            <div className="stacked-controls">
              <Field label="优先级" type="number" value={item.priority ?? 50} onChange={(value) => update(index, { priority: value })} />
              <label className="toggle-field compact-toggle"><input type="checkbox" checked={item.enabled !== false} onChange={(event) => update(index, { enabled: event.target.checked })} /> 启用</label>
            </div>
            <button className="icon-danger" onClick={() => remove(index)} title="删除" aria-label="删除话术"><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function DimensionStep({ activity, setActivity, totalWeight }) {
  function add() {
    setActivity({ ...activity, dimensions: [...activity.dimensions, makeDimension('', 0, activity.dimensions.length)] });
  }
  function update(index, patch) {
    const next = [...activity.dimensions];
    next[index] = { ...next[index], ...patch };
    setActivity({ ...activity, dimensions: next });
  }
  function remove(index) {
    setActivity({ ...activity, dimensions: activity.dimensions.filter((_, itemIndex) => itemIndex !== index) });
  }
  return (
    <div>
      <SectionTitle icon={<Bot />} title="评分维度" aside={`权重合计：${totalWeight}%`} />
      <button className="outline-button" onClick={add}><Plus size={16} /> 添加评分维度</button>
      <div className="dimension-editor">
        {activity.dimensions.map((item, index) => (
          <div className="dimension-card" key={index}>
            <Field label="维度名称" value={item.name} onChange={(value) => update(index, { name: value })} />
            <Field label="权重" type="number" value={item.weight} onChange={(value) => update(index, { weight: value })} />
            <Field label="评分标准" value={item.scoring_criteria} onChange={(value) => update(index, { scoring_criteria: value })} textarea />
            <Field label="扣分规则（一行一个）" value={joinLines(item.deduction_rules)} onChange={(value) => update(index, { deduction_rules: splitLines(value) })} textarea />
            <Field label="改进建议" value={item.improvement_advice} onChange={(value) => update(index, { improvement_advice: value })} textarea />
            <Field label="风险触发词（一行一个）" value={joinLines(item.risk_triggers)} onChange={(value) => update(index, { risk_triggers: splitLines(value) })} textarea />
            <button className="danger-link" onClick={() => remove(index)}>删除维度</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PublishStep({ activity, setActivity, totalWeight, show }) {
  const voice = activity.voice_settings || {};
  async function uploadBackground(file) {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const result = await api('/api/admin/uploads/backgrounds', { method: 'POST', body: form });
      setActivity({ ...activity, chat_background_type: 'upload', chat_background_value: result.url });
      show('背景图片已上传', 'success');
    } catch (error) {
      show(error.message);
    }
  }

  function updateVoice(patch) {
    setActivity({ ...activity, voice_settings: { ...voice, ...patch } });
  }

  return (
    <div className="publish-grid">
      <div className="form-grid publish-form">
        <SectionTitle icon={<CalendarClock />} title="发布配置" />
        <Field label="学员端入口说明" value={activity.entry_description} onChange={(value) => setActivity({ ...activity, entry_description: value })} textarea />
        <Field label="开始时间" type="datetime-local" value={activity.starts_at} onChange={(value) => setActivity({ ...activity, starts_at: value })} />
        <Field label="结束时间" type="datetime-local" value={activity.ends_at} onChange={(value) => setActivity({ ...activity, ends_at: value })} />
        <label className="field"><span>发布状态</span><select value={activity.status} onChange={(event) => setActivity({ ...activity, status: event.target.value })}><option value="draft">草稿</option><option value="published">已发布</option><option value="offline">已下线</option></select></label>
        <SectionTitle icon={<Headphones />} title="语音体验" />
        <label className="field"><span>AI 音色</span><select value={voice.voice || DEFAULT_TTS_VOICE} onChange={(event) => updateVoice({ voice: event.target.value })}><option value="杜小雯">杜小雯</option></select></label>
        <Field label="语速" type="number" value={voice.speed || 1} onChange={(value) => updateVoice({ speed: Number(value || 1) })} />
        <label className="field toggle-field"><span>自动播放 AI 回复</span><input type="checkbox" checked={voice.auto_play !== false} onChange={(event) => updateVoice({ auto_play: event.target.checked })} /></label>
        <label className="field"><span>默认输入方式</span><select value={voice.default_input_mode || 'voice'} onChange={(event) => updateVoice({ default_input_mode: event.target.value })}><option value="voice">语音输入</option><option value="text">文字输入</option></select></label>
        <label className="field toggle-field"><span>连续语音对话</span><input type="checkbox" checked={voice.continuous_voice !== false} onChange={(event) => updateVoice({ continuous_voice: event.target.checked })} /></label>
        <SectionTitle icon={<ImagePlus />} title="对话背景" />
        <label className="field"><span>背景类型</span><select value={activity.chat_background_type} onChange={(event) => setActivity({ ...activity, chat_background_type: event.target.value })}><option value="preset">预设背景</option><option value="upload">上传图片</option><option value="url">图片 URL</option></select></label>
        {activity.chat_background_type === 'preset' && <label className="field"><span>预设背景</span><select value={activity.chat_background_value} onChange={(event) => setActivity({ ...activity, chat_background_value: event.target.value })}>{backgroundPresets.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>}
        {activity.chat_background_type === 'upload' && <label className="field upload-field"><span>上传背景图片</span><input type="file" accept="image/*" onChange={(event) => uploadBackground(event.target.files?.[0])} /></label>}
        {(activity.chat_background_type === 'upload' || activity.chat_background_type === 'url') && <Field label="背景图片地址" value={activity.chat_background_value} onChange={(value) => setActivity({ ...activity, chat_background_value: value })} />}
        <label className="field"><span>背景遮罩强度：{Math.round(Number(activity.chat_background_overlay || 0) * 100)}%</span><input type="range" min="0" max="0.85" step="0.05" value={activity.chat_background_overlay} onChange={(event) => setActivity({ ...activity, chat_background_overlay: event.target.value })} /></label>
        <div className={`publish-check ${totalWeight === 100 ? 'ok' : 'warn'}`}><AlertCircle size={18} />评价维度权重合计 {totalWeight}%，发布时必须等于 100%。</div>
      </div>
      <div className="background-preview" style={backgroundStyle(activity)}>
        <div style={{ backgroundColor: `rgba(6, 16, 31, ${activity.chat_background_overlay || 0})` }} />
        <section>
          <span>练习页预览</span>
          <h3>{activity.persona?.customer_name || 'AI 客户'}</h3>
          <p>{activity.opening_line || '这里会展示 AI 客户的开场语。'}</p>
        </section>
      </div>
    </div>
  );
}

function ActivityList() {
  const { toast, show } = useToast();
  const [activities, setActivities] = useState([]);
  useEffect(() => { api('/api/public/activities').then(setActivities).catch((error) => show(error.message)); }, []);
  return (
    <UserShell>
      <div className="user-hero">
        <div>
          <span className="eyebrow">Training Center</span>
          <h1>选择陪练任务</h1>
          <p>完成语音或文字对练后提交质检，报告发布后在“我的报告”查看。</p>
        </div>
        <Sparkles size={34} />
      </div>
      {toast && <Notice message={toast.message} kind={toast.kind} />}
      <div className="activity-grid">
        {activities.map((activity) => (
          <article className="activity-card" key={activity.id}>
            <div className="activity-card-top"><StatusBadge status="published" /><span><Clock3 size={15} />{activity.average_minutes} 分钟</span></div>
            <h2>{activity.title}</h2>
            <p>{activity.entry_description || activity.description}</p>
            <small>{formatDate(activity.starts_at)} - {formatDate(activity.ends_at)}</small>
            <Link className="primary compact" to={`/activities/${activity.id}/practice`}>开始陪练</Link>
          </article>
        ))}
        {!activities.length && <div className="empty">当前没有可参与的活动。</div>}
      </div>
    </UserShell>
  );
}

function PracticePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, show } = useToast();
  const [activity, setActivity] = useState(null);
  const [session, setSession] = useState(null);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [hintLoading, setHintLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const [recording, setRecording] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voicePaused, setVoicePaused] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('idle');
  const [voiceLevel, setVoiceLevel] = useState(0);
  const recorderRef = useRef(null);
  const audioRef = useRef(null);
  const messagesRef = useRef(null);
  const sessionRef = useRef(null);
  const activityRef = useRef(null);
  const streamingRef = useRef(false);
  const submittedRef = useRef(false);
  const mutedRef = useRef(false);
  const voicePausedRef = useRef(false);
  const voiceStatusRef = useRef('idle');
  const initialVoicePlayedRef = useRef(false);
  const submitted = session?.assessment_status && session.assessment_status !== 'not_submitted';
  const canSubmit = Boolean(session && !submitted && !streaming);

  useEffect(() => { api(`/api/public/activities/${id}`).then((data) => setActivity(normalizeActivity(data))).catch((error) => show(error.message)); }, [id]);
  useEffect(() => { setMessages(session?.messages || []); }, [session]);
  useEffect(() => { activityRef.current = activity; }, [activity]);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { streamingRef.current = streaming; }, [streaming]);
  useEffect(() => { submittedRef.current = Boolean(submitted); }, [submitted]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { voicePausedRef.current = voicePaused; }, [voicePaused]);
  useEffect(() => { voiceStatusRef.current = voiceStatus; }, [voiceStatus]);
  useEffect(() => {
    if (session && !voicePaused && !streaming && voiceStatus === 'idle' && isContinuousVoiceEnabled()) startContinuousListeningSoon();
  }, [session, voicePaused, streaming, voiceStatus]);
  useEffect(() => () => {
    stopContinuousListening();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, []);
  useEffect(() => {
    const node = messagesRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: 'auto' });
  }, [messages, streaming]);
  useEffect(() => {
    const viewport = window.visualViewport;

    const syncVisualViewport = () => {
      const visualHeight = viewport?.height || window.innerHeight;
      const visualTop = viewport?.offsetTop || 0;
      const keyboardInset = Math.max(0, window.innerHeight - visualHeight - visualTop);

      document.documentElement.style.setProperty('--practice-visual-height', `${visualHeight}px`);
      document.documentElement.style.setProperty('--practice-visual-top', `${visualTop}px`);
      document.documentElement.style.setProperty('--practice-keyboard-inset', `${keyboardInset}px`);
      if (document.activeElement?.tagName === 'TEXTAREA') {
        window.setTimeout(() => {
          const node = messagesRef.current;
          if (node) node.scrollTo({ top: node.scrollHeight, behavior: 'auto' });
        }, 80);
      }
    };

    syncVisualViewport();
    window.addEventListener('resize', syncVisualViewport);
    window.addEventListener('orientationchange', syncVisualViewport);
    viewport?.addEventListener('resize', syncVisualViewport);
    viewport?.addEventListener('scroll', syncVisualViewport);
    return () => {
      window.removeEventListener('resize', syncVisualViewport);
      window.removeEventListener('orientationchange', syncVisualViewport);
      viewport?.removeEventListener('resize', syncVisualViewport);
      viewport?.removeEventListener('scroll', syncVisualViewport);
      document.documentElement.style.removeProperty('--practice-visual-height');
      document.documentElement.style.removeProperty('--practice-visual-top');
      document.documentElement.style.removeProperty('--practice-keyboard-inset');
    };
  }, []);

  function handleComposerFocus() {
    window.setTimeout(() => {
      const node = messagesRef.current;
      if (node) node.scrollTo({ top: node.scrollHeight, behavior: 'auto' });
    }, 260);
  }

  async function start() {
    setStreaming(true);
    try {
      const nextSession = await api('/api/practice/sessions', { method: 'POST', body: JSON.stringify({ activity_id: Number(id) }) });
      setSession(nextSession);
      if (isContinuousVoiceEnabled(nextSession)) {
        const firstReply = [...(nextSession.messages || [])].reverse().find((item) => item.role === 'ai_customer');
        initialVoicePlayedRef.current = true;
        if (firstReply && activity?.voice_settings?.auto_play !== false && !mutedRef.current) await playText(firstReply.content);
        startContinuousListeningSoon();
      }
    } catch (error) {
      show(error.message);
    } finally {
      setStreaming(false);
    }
  }

  function isContinuousVoiceEnabled(nextSession = sessionRef.current) {
    const voice = activityRef.current?.voice_settings || {};
    return Boolean(
      nextSession
      && voice.default_input_mode === 'voice'
      && voice.continuous_voice !== false
      && !voicePausedRef.current
      && !submittedRef.current
    );
  }

  function startContinuousListeningSoon() {
    window.setTimeout(() => {
      startContinuousListening();
    }, 180);
  }

  async function stopContinuousListening() {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setVoiceLevel(0);
    if (!recorder) return null;
    try {
      return await recorder.stop();
    } catch {
      return null;
    }
  }

  async function startContinuousListening() {
    if (!isContinuousVoiceEnabled() || streamingRef.current || voiceStatusRef.current !== 'idle' || recorderRef.current) return;
    if (!window.isSecureContext && !isLocalHost(window.location.hostname)) {
      setVoicePaused(true);
      show('手机录音需要 HTTPS 安全访问，请用 HTTPS 地址打开。');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoicePaused(true);
      show('当前浏览器不支持录音，请使用 Chrome、Edge 或 Safari。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setVoiceStatus('listening');
      recorderRef.current = await createWavRecorder(stream, {
        vad: true,
        onLevel: (level) => setVoiceLevel(Math.min(1, level / 0.08)),
        onSpeechStart: () => setVoiceStatus('speaking'),
        onSilenceEnd: () => finishContinuousVoice(),
      });
    } catch {
      setVoicePaused(true);
      setVoiceStatus('idle');
      show('无法访问麦克风，请检查浏览器授权。');
    }
  }

  async function finishContinuousVoice() {
    if (!recorderRef.current || streamingRef.current) return;
    setVoiceStatus('transcribing');
    const blob = await stopContinuousListening();
    if (!blob || !blob.size || !isContinuousVoiceEnabled()) {
      setVoiceStatus('idle');
      return;
    }
    try {
      const form = new FormData();
      form.append('file', blob, 'voice.wav');
      const result = await api('/api/speech/transcribe', { method: 'POST', body: form });
      const text = String(result.text || '').trim();
      if (!text) {
        setVoiceStatus('idle');
        startContinuousListeningSoon();
        return;
      }
      await send(text, 'voice');
    } catch (error) {
      setVoiceStatus('idle');
      show(error.message);
      startContinuousListeningSoon();
    }
  }

  async function send(inputContent = draft, inputMode = 'text') {
    const content = String(inputContent || '').trim();
    if (!content || !session || streaming) return;
    if (inputMode === 'text') setDraft('');
    await stopContinuousListening();
    setStreaming(true);
    setVoiceStatus(inputMode === 'voice' ? 'streaming' : 'idle');
    const tempUser = { id: `local-${Date.now()}`, role: 'trainee', content, input_mode: inputMode, created_at: new Date().toISOString() };
    const tempAi = { id: `stream-${Date.now()}`, role: 'ai_customer', content: '', input_mode: 'system', created_at: new Date().toISOString(), streaming: true };
    setMessages((current) => [...current, tempUser, tempAi]);
    try {
      await streamSessionMessage(session.id, content, {
        onUserMessage: (message) => setMessages((current) => current.map((item) => (item.id === tempUser.id ? message : item))),
        onDelta: (delta) => setMessages((current) => current.map((item) => (item.id === tempAi.id ? { ...item, content: item.content + delta } : item))),
        onDone: async (nextSession) => {
          setSession(nextSession);
          const lastReply = [...(nextSession.messages || [])].reverse().find((item) => item.role === 'ai_customer');
          if (lastReply && activity?.voice_settings?.auto_play !== false && !mutedRef.current) await playText(lastReply.content);
          startContinuousListeningSoon();
        },
        onError: async (detail) => {
          show(detail);
          setSession(await api(`/api/practice/sessions/${session.id}`));
        },
      }, inputMode);
    } catch (error) {
      show(error.message);
      setSession(await api(`/api/practice/sessions/${session.id}`));
    } finally {
      setStreaming(false);
      setVoiceStatus('idle');
    }
  }

  async function requestHint() {
    if (!session || streaming || hintLoading || submitted) return;
    setHintLoading(true);
    try {
      const result = await api(`/api/practice/sessions/${session.id}/hints`, { method: 'POST' });
      setMessages((current) => [...current, result.message]);
      setSession((current) => current ? { ...current, messages: [...(current.messages || []), result.message] } : current);
    } catch (error) {
      show(error.message);
    } finally {
      setHintLoading(false);
    }
  }

  async function submitForReview() {
    if (!session) return;
    await stopContinuousListening();
    setStreaming(true);
    try {
      const result = await api(`/api/practice/sessions/${session.id}/submit`, { method: 'POST' });
      setSession(result.session);
      navigate(`/activities/${id}/practice/submitted`, {
        state: {
          activityTitle: activity?.title,
          reportId: result.report_id,
          reportStatus: result.report_status,
        },
      });
    } catch (error) {
      show(error.message);
    } finally {
      setStreaming(false);
    }
  }

  async function toggleRecord() {
    setVoicePaused(true);
    if (recording) {
      setRecording(false);
      try {
        const blob = await recorderRef.current?.stop();
        if (!blob || !blob.size) return;
        const form = new FormData();
        form.append('file', blob, 'voice.wav');
        const result = await api('/api/speech/transcribe', { method: 'POST', body: form });
        setDraft(result.text);
      } catch (error) {
        show(error.message);
      } finally {
        recorderRef.current = null;
      }
      return;
    }
    if (!window.isSecureContext && !isLocalHost(window.location.hostname)) {
      show('手机录音需要 HTTPS 安全访问，请用 HTTPS 地址打开。');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      show('当前浏览器不支持录音，请使用 Chrome、Edge 或 Safari。');
      return;
    }
    try {
      await stopContinuousListening();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorderRef.current = await createWavRecorder(stream);
      setRecording(true);
    } catch {
      show('无法访问麦克风，请检查浏览器授权。');
    }
  }

  async function playText(text) {
    if (!text || muted) return;
    try {
      if (audioRef.current) audioRef.current.pause();
      setVoiceStatus('playing');
      const voice = activity?.voice_settings || {};
      const result = await api('/api/speech/synthesize', { method: 'POST', body: JSON.stringify({ text, voice: voice.voice || DEFAULT_TTS_VOICE, speed: Number(voice.speed || 1) }) });
      const audio = new Audio(`data:${result.mime_type};base64,${result.audio_base64}`);
      audioRef.current = audio;
      await new Promise((resolve, reject) => {
        audio.onended = resolve;
        audio.onerror = reject;
        audio.play().catch(reject);
      });
    } catch (error) {
      show(error.message);
    } finally {
      audioRef.current = null;
      setVoiceStatus('idle');
    }
  }

  function handleDraftKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent?.isComposing) return;
    event.preventDefault();
    send();
  }

  if (!activity) return <div className="page-loading">正在加载活动...</div>;
  const voiceSettings = activity.voice_settings || {};
  const continuousVoiceConfigured = voiceSettings.default_input_mode === 'voice' && voiceSettings.continuous_voice !== false;
  const voiceStatusText = {
    idle: voicePaused ? '语音已暂停' : '准备监听',
    listening: '正在监听',
    speaking: '正在收音',
    transcribing: '正在转写',
    streaming: 'AI 正在回复',
    playing: '正在播放 AI 回复',
  }[voiceStatus] || '准备监听';
  return (
    <div className={`practice-page ${session ? 'practice-chat-page' : ''}`} style={backgroundStyle(activity)}>
      <div className="practice-overlay" style={{ backgroundColor: `rgba(6, 16, 31, ${activity.chat_background_overlay || 0})` }} />
      <TopNav userSide />
      <main className={`practice-layout ${session ? 'chat-only' : 'start-only'}`}>
        {toast && <Notice message={toast.message} kind={toast.kind} />}
        {!session ? <aside className="practice-side practice-start-card">
          <Link to="/activities" className="back-button"><ArrowLeft size={16} /> 返回活动</Link>
          <span className="eyebrow">Immersive Coaching</span>
          <h1>{activity.title}</h1>
          <p>{activity.training_goal}</p>
          {activity.persona && <div className="persona-summary"><b>{activity.persona.customer_name || 'AI 客户'}</b><span>{activity.persona.identity}</span><p>{activity.persona.background}</p></div>}
          <div className="voice-panel">
            <b><Volume2 size={16} /> 语音陪练</b>
            <button onClick={() => setMuted(!muted)}>{muted ? <Pause size={16} /> : <Play size={16} />}{muted ? '已静音' : '自动播放'}</button>
            <span>音色 {activity.voice_settings?.voice || DEFAULT_TTS_VOICE} · 语速 {activity.voice_settings?.speed || 1}</span>
          </div>
          <button className="primary" onClick={start} disabled={streaming}>开始本次陪练</button>
        </aside> : <section className="chat-workspace">
          <header className="chat-header">
            <div className="chat-title">
              <Link to="/activities" className="chat-back-button" aria-label="返回活动"><ArrowLeft size={18} /></Link>
              <div className="chat-avatar"><Headphones size={18} /></div>
              <div><b>{activity.persona?.customer_name || 'AI 客户'}</b><span>{submitted ? '等待质检报告' : '在线陪练中'}</span></div>
            </div>
            {canSubmit && <button className="chat-submit-button" onClick={submitForReview}>提交质检</button>}
          </header>
          {continuousVoiceConfigured && <div className="voice-status-bar">
            <div><Mic size={16} /><span>{voiceStatusText}</span><i style={{ transform: `scaleX(${Math.max(0.08, voiceLevel)})` }} /></div>
            <button onClick={() => {
              const nextPaused = !voicePaused;
              setVoicePaused(nextPaused);
              if (nextPaused) {
                setVoiceStatus('idle');
                stopContinuousListening();
              } else {
                startContinuousListeningSoon();
              }
            }}>{voicePaused ? '开启语音' : '结束语音'}</button>
          </div>}
          <div className="messages" ref={messagesRef}>
            {messages.map((item) => <MessageBubble key={item.id} item={item} onPlay={() => playText(item.content)} onUseHint={() => setDraft(item.content)} />)}
            {streaming && messages.some((item) => item.streaming && !item.content) && <div className="typing">AI 客户正在输入...</div>}
            {!session && <div className="empty">点击开始后，AI 客户会先发起对话。</div>}
          </div>
          <div className="composer">
            <textarea value={draft} onFocus={handleComposerFocus} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleDraftKeyDown} disabled={!session || streaming || submitted} />
            <div className="composer-actions">
              <button
                aria-label={recording ? '停止录音' : '开始录音'}
                title={recording ? '停止录音' : '开始录音'}
                onClick={toggleRecord}
                disabled={!session || streaming || submitted}
                className={`record-button ${recording ? 'recording' : ''}`}
              >
                {recording ? <Pause size={18} /> : <Mic size={18} />}
              </button>
              <button
                aria-label="AI 提示"
                title="AI 提示"
                onClick={requestHint}
                disabled={!session || streaming || hintLoading || submitted}
              >
                <Sparkles size={18} /> <span>{hintLoading ? '生成中' : 'AI 提示'}</span>
              </button>
              <button className="primary compact send-button" aria-label="发送" title="发送" onClick={send} disabled={!session || streaming || submitted || !draft.trim()}><Send size={17} /> <span>发送</span></button>
            </div>
          </div>
        </section>}
      </main>
    </div>
  );
}

function PracticeSubmittedPage() {
  const { id } = useParams();
  const location = useLocation();
  const locationState = location.state || {};
  const statusText = reportStatusText[locationState.reportStatus] || locationState.reportStatus || 'AI 自动评分中';
  return (
    <UserShell>
      <section className="submitted-guide">
        <div className="submitted-icon"><FileCheck2 size={34} /></div>
        <span className="eyebrow">Quality Review</span>
        <h1>AI 正在自动评分</h1>
        <p>{locationState.activityTitle ? `“${locationState.activityTitle}”` : '本次陪练'}已提交，AI 会在后台自动评分，完成后报告会出现在“我的报告”。</p>
        <div className="submitted-meta">
          <span>报告编号</span>
          <b>{locationState.reportId ? `#${locationState.reportId}` : '已生成'}</b>
          <span>当前状态</span>
          <b>{statusText}</b>
        </div>
        <div className="submitted-actions">
          <Link className="primary compact" to="/reports">去我的报告</Link>
          <Link className="outline-button compact" to="/activities">返回训练中心</Link>
          <Link className="ghost-link" to={`/activities/${id}/practice`}>再练一次</Link>
        </div>
      </section>
    </UserShell>
  );
}

function ReviewQueue() {
  const navigate = useNavigate();
  const { toast, show } = useToast();
  const [reports, setReports] = useState([]);
  useEffect(() => { refresh(); }, []);
  async function refresh() {
    try {
      setReports(await api('/api/reviews'));
    } catch (error) {
      show(error.message);
    }
  }
  return (
    <AdminShell>
      <div className="page-title">
        <div><span className="eyebrow">质检中心</span><h1>质检中心</h1><p>学员提交后由 AI 自动评分并发布，这里用于查看评分结果和异常状态。</p></div>
      </div>
      {toast && <Notice message={toast.message} kind={toast.kind} />}
      <div className="table-card">
        <table>
          <thead><tr><th>报告</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead>
          <tbody>
            {reports.map((report) => (
              <tr key={report.id}>
                <td data-label="报告"><b>{formatEntityId('R', report.id)}</b><span>会话 {formatEntityId('S', report.session_id)} / 活动 {formatEntityId('A', report.activity_id)} / 学员 {formatEntityId('U', report.user_id)}</span></td>
                <td data-label="状态"><ReportStatus status={report.status} /></td>
                <td data-label="提交时间">{formatDateTime(report.submitted_at)}</td>
                <td data-label="操作" className="actions">
                  <button onClick={() => navigate(`/admin/reviews/${report.id}`)}>查看</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!reports.length && <div className="empty">暂无待质检报告。</div>}
      </div>
    </AdminShell>
  );
}

function ReviewDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, show } = useToast();
  const [report, setReport] = useState(null);

  useEffect(() => { refresh(); }, [id]);
  async function refresh() {
    try {
      const data = await api(`/api/reviews/${id}`);
      setReport(data);
    } catch (error) {
      show(error.message);
    }
  }

  if (!report) return <div className="page-loading">正在加载报告...</div>;
  const parsed = report.final_report || report.ai_report || {};
  return (
    <AdminShell wide>
      <button className="back-button" onClick={() => navigate('/admin/reviews')}><ArrowLeft size={16} /> 返回质检中心</button>
      <div className="editor-header">
        <div><span className="eyebrow">质检详情</span><h1>质检报告 {formatEntityId('R', report.id)}</h1></div>
        <ReportStatus status={report.status} />
      </div>
      {toast && <Notice message={toast.message} kind={toast.kind} />}
      <div className="review-layout">
        <section className="wizard-card">
          <SectionTitle icon={<FileText />} title="自动评分记录" aside="只读" />
          <div className="submitted-meta">
            <span>会话编号</span>
            <b>{formatEntityId('S', report.session_id)}</b>
            <span>学员编号</span>
            <b>{formatEntityId('U', report.user_id)}</b>
            <span>提交时间</span>
            <b>{formatDateTime(report.submitted_at)}</b>
            <span>评分完成</span>
            <b>{report.ai_generated_at ? formatDateTime(report.ai_generated_at) : '-'}</b>
          </div>
          {report.reviewer_notes && <div className="advice-panel"><b>系统备注</b><p>{report.reviewer_notes}</p></div>}
        </section>
        <ReportCard report={parsed} />
      </div>
    </AdminShell>
  );
}

function MyReports() {
  const { toast, show } = useToast();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api('/api/reports/my')
      .then(setReports)
      .catch((error) => show(error.message))
      .finally(() => setLoading(false));
  }, []);
  const scoreValues = reports.map((report) => getReportPayload(report).total_score).filter((score) => typeof score === 'number');
  const averageScore = scoreValues.length ? roundOne(scoreValues.reduce((sum, score) => sum + score, 0) / scoreValues.length) : null;
  const strongReports = reports.filter((report) => (getReportPayload(report).total_score || 0) >= 85).length;
  const needsImprovement = reports.filter((report) => (getReportPayload(report).total_score || 0) < 70).length;
  if (loading) return <UserShell><div className="page-loading">正在加载报告...</div></UserShell>;
  return (
    <UserShell>
      <div className="page-title reports-hero">
        <div>
          <span className="eyebrow">已发布报告</span>
          <h1>我的报告</h1>
          <p>查看已完成评分的陪练结果，先关注总分、评级和风险提示，再进入单份报告复盘细节。</p>
        </div>
      </div>
      <div className="metric-grid reports-metrics">
        <Metric label="已发布报告" value={reports.length} />
        <Metric label="平均分" value={averageScore ?? '-'} tone="ok" />
        <Metric label="优秀报告" value={strongReports} />
        <Metric label="待提升" value={needsImprovement} tone="warn" />
      </div>
      {toast && <Notice message={toast.message} kind={toast.kind} />}
      <div className="table-card report-list-card">
        <div className="report-list-header">
          <div>
            <h2>报告概览</h2>
            <p>点击“查看详情”进入完整评分明细。</p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>报告</th>
                <th>总分</th>
                <th>评级</th>
                <th>维度表现</th>
                <th>风险</th>
                <th>发布时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => {
                const payload = getReportPayload(report);
                const dimensions = Array.isArray(payload.dimension_scores) ? payload.dimension_scores : [];
                const riskCount = Array.isArray(payload.compliance_risks) ? payload.compliance_risks.length : 0;
                const summary = summarizeDimensions(dimensions);
                const score = payload.total_score ?? null;
                const scoreTone = getScoreTone(score);
                return (
                  <tr key={report.id}>
                    <td data-label="报告">
                      <b>{formatEntityId('R', report.id)}</b>
                      <span>会话 {formatEntityId('S', report.session_id)} / 活动 {formatEntityId('A', report.activity_id)}</span>
                    </td>
                    <td data-label="总分">
                      <div className="score-cell">
                        <strong className={`score-value ${scoreTone.className}`}>{score ?? '-'}</strong>
                        <span>{scoreTone.label}</span>
                      </div>
                    </td>
                    <td data-label="评级">
                      <span className={`score-pill ${scoreTone.className}`}>{scoreTone.label}</span>
                    </td>
                    <td data-label="维度表现">
                      <b>{dimensions.length} 项维度</b>
                      <span>{summary || '暂无维度摘要'}</span>
                    </td>
                    <td data-label="风险">
                      <b>{riskCount}</b>
                      <span>{riskCount ? '存在合规提示' : '未见明显风险'}</span>
                    </td>
                    <td data-label="发布时间">{formatDateTime(report.published_at || report.updated_at)}</td>
                    <td data-label="操作" className="actions">
                      <Link className="text-button" to={`/reports/${report.id}`}>查看详情</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!reports.length && <div className="empty">暂无已评分报告。</div>}
      </div>
    </UserShell>
  );
}

function MyReportDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, show } = useToast();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api('/api/reports/my')
      .then(setReports)
      .catch((error) => show(error.message))
      .finally(() => setLoading(false));
  }, []);

  const report = reports.find((item) => String(item.id) === String(id));

  if (loading) return <UserShell><div className="page-loading">正在加载报告...</div></UserShell>;
  if (!report) {
    return (
      <UserShell>
        <button className="back-button" onClick={() => navigate('/reports')}><ArrowLeft size={16} /> 返回报告列表</button>
        <div className="empty report-empty">
          <h2>未找到该报告</h2>
          <p>当前账号下没有这条已发布报告，或报告尚未发布。</p>
          <Link className="primary compact" to="/reports">返回报告列表</Link>
        </div>
      </UserShell>
    );
  }

  const payload = getReportPayload(report);
  const dimensions = Array.isArray(payload.dimension_scores) ? payload.dimension_scores : [];
  const risks = Array.isArray(payload.compliance_risks) ? payload.compliance_risks : [];
  const suggestions = (payload.improvement_suggestions || payload.issues || []).filter(Boolean);

  return (
    <UserShell>
      <button className="back-button" onClick={() => navigate('/reports')}><ArrowLeft size={16} /> 返回报告列表</button>
      <ReportHeader report={report} payload={payload} />
      {toast && <Notice message={toast.message} kind={toast.kind} />}
      <div className="report-summary-grid">
        <div className="metric-card">
          <span>维度数量</span>
          <b>{dimensions.length}</b>
        </div>
        <div className="metric-card">
          <span>合规风险</span>
          <b>{risks.length}</b>
        </div>
        <div className="metric-card">
          <span>改进建议</span>
          <b>{suggestions.length}</b>
        </div>
        <div className="metric-card">
          <span>评分完成</span>
          <b>{report.ai_generated_at ? formatDate(report.ai_generated_at) : '-'}</b>
        </div>
      </div>
      {report.reviewer_notes && <InsightList title="报告备注" items={[report.reviewer_notes]} emptyText="暂无报告备注。" />}
      <div className="detail-sections">
        <section className="table-card detail-section report-reading-section">
          <div className="report-list-header">
            <div>
              <h2>评估维度</h2>
              <p>每个维度保留权重、得分、证据和建议，便于快速定位问题。</p>
            </div>
          </div>
          <DimensionScoreList dimensions={dimensions} />
        </section>
        <InsightList
          title="合规风险"
          description="展示触发的风险点与对应规则。"
          items={risks}
          emptyText="暂无合规风险。"
          getTitle={(risk) => risk.phrase || '风险提示'}
          getBody={(risk) => risk.rule || '暂无规则说明'}
        />
        <InsightList
          title="改进建议"
          description="用于后续复盘和下一次练习优化。"
          items={suggestions}
          emptyText="暂无改进建议。"
          wide
        />
      </div>
    </UserShell>
  );
}

function AnalyticsPage() {
  const { toast, show } = useToast();
  const [data, setData] = useState(null);
  useEffect(() => { api('/api/admin/analytics/overview').then(setData).catch((error) => show(error.message)); }, []);
  if (!data) return <div className="page-loading">正在加载数据看板...</div>;
  return (
    <AdminShell wide>
      <div className="page-title">
        <div><span className="eyebrow">运营数据</span><h1>数据看板</h1><p>跟踪活动参与、质检积压、评分表现和合规风险。</p></div>
      </div>
      {toast && <Notice message={toast.message} kind={toast.kind} />}
      <div className="metric-grid">
        <Metric label="活动数" value={data.activities} />
        <Metric label="已发布活动" value={data.published_activities} />
        <Metric label="陪练会话" value={data.sessions} />
        <Metric label="已提交质检" value={data.submitted_sessions} />
        <Metric label="待 AI 评分" value={data.pending_reviews} tone="warn" />
        <Metric label="已评分报告" value={data.approved_reports} tone="ok" />
        <Metric label="平均分" value={data.average_score ?? '-'} />
        <Metric label="用户数" value={data.users} />
      </div>
      <div className="analytics-grid">
        <section className="dashboard-panel">
          <h2>维度均分</h2>
          {(data.dimension_scores || []).map((item) => <BarRow key={item.name} label={item.name} value={item.score} />)}
          {!data.dimension_scores?.length && <div className="empty small">暂无已发布评分数据。</div>}
        </section>
        <section className="dashboard-panel">
          <h2>合规风险热词</h2>
          {(data.risk_counts || []).map((item) => <BarRow key={item.phrase} label={item.phrase} value={item.count} max={Math.max(...data.risk_counts.map((risk) => risk.count), 1)} />)}
          {!data.risk_counts?.length && <div className="empty small">暂无合规风险数据。</div>}
        </section>
        <section className="dashboard-panel wide-panel">
          <h2>最近会话</h2>
          <div className="mini-list">
            {data.recent_sessions.map((item) => <span key={item.id}>会话 {formatEntityId('S', item.id)} / 活动 {formatEntityId('A', item.activity_id)} / {item.status} / {formatDateTime(item.updated_at)}</span>)}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}

function AdminShell({ children, wide = false }) {
  return <div className="admin-shell"><TopNav /><main className={`page-container ${wide ? 'wide-container' : ''}`}>{children}</main></div>;
}

function UserShell({ children }) {
  return <div className="user-shell"><TopNav userSide /><main className="page-container">{children}</main></div>;
}

function MessageBubble({ item, onPlay, onUseHint }) {
  const isUser = item.role === 'trainee';
  const isHint = item.role === 'ai_hint';
  return (
    <div className={`message ${isUser ? 'trainee' : isHint ? 'ai_hint' : 'ai_customer'}`}>
      <div className="avatar">{isUser ? <UserRound size={16} /> : isHint ? <Sparkles size={16} /> : <Bot size={16} />}</div>
      <div>
        <span>{isUser ? '我' : isHint ? 'AI 提示（仅自己可见）' : 'AI 客户'}</span>
        <p>{item.content || (item.streaming ? '...' : '')}</p>
        {isHint && item.content && <button className="listen-button" onClick={onUseHint}><FileText size={14} /> 填入输入框</button>}
        {!isUser && !isHint && item.content && <button className="listen-button" onClick={onPlay}><Volume2 size={14} /> 重播</button>}
      </div>
    </div>
  );
}

async function streamSessionMessage(sessionId, content, handlers, inputMode = 'text') {
  const response = await fetch(`${API_BASE}/api/practice/sessions/${sessionId}/messages/stream`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ content, input_mode: inputMode }),
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `请求失败：${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      const event = parseSse(part);
      if (!event) continue;
      if (event.event === 'user_message') handlers.onUserMessage(event.data);
      if (event.event === 'delta') handlers.onDelta(event.data.content || '');
      if (event.event === 'done') await handlers.onDone(event.data);
      if (event.event === 'error') await handlers.onError(event.data.detail || '模型服务暂时不可用');
    }
  }
}

function parseSse(chunk) {
  const eventLine = chunk.split('\n').find((line) => line.startsWith('event:'));
  const dataLine = chunk.split('\n').find((line) => line.startsWith('data:'));
  if (!eventLine || !dataLine) return null;
  return { event: eventLine.replace('event:', '').trim(), data: JSON.parse(dataLine.replace('data:', '').trim()) };
}

function ReportHeader({ report, payload }) {
  const scoreTone = getScoreTone(payload.total_score);
  return (
    <section className="report-page-header">
      <div className="report-title-block">
        <span className="eyebrow">已发布报告</span>
        <h1>陪练评分报告</h1>
        <ReportMeta report={report} />
      </div>
      <div className="report-score-panel">
        <span className={`score-pill ${scoreTone.className}`}>{scoreTone.label}</span>
        <strong>{payload.total_score ?? '-'}</strong>
        <small>综合评分</small>
      </div>
    </section>
  );
}

function ReportMeta({ report }) {
  const publishedAt = report.published_at || report.updated_at;
  return (
    <div className="report-meta">
      <span><b>报告编号</b>{formatEntityId('R', report.id)}</span>
      <span><b>会话编号</b>{formatEntityId('S', report.session_id)}</span>
      <span><b>活动编号</b>{formatEntityId('A', report.activity_id)}</span>
      <span><b>发布时间</b>{formatDateTime(publishedAt)}</span>
    </div>
  );
}

function DimensionScoreList({ dimensions }) {
  if (!dimensions.length) return <div className="empty small">暂无维度明细。</div>;
  return (
    <div className="dimension-score-list">
      {dimensions.map((item) => {
        const dimensionTone = getScoreTone(item.score);
        return (
          <article className="dimension-score-item" key={item.dimension_id || item.name}>
            <div className="dimension-score-head">
              <div>
                <h3>{item.name || '未命名维度'}</h3>
                <span>权重 {item.weight ?? '-'}%</span>
              </div>
              <span className={`score-pill ${dimensionTone.className}`}>{item.score ?? '-'} 分 · {dimensionTone.label}</span>
            </div>
            <div className="dimension-meter" aria-hidden="true">
              <i style={{ width: `${scorePercent(item.score)}%` }} />
            </div>
            <div className="dimension-copy-grid">
              <div>
                <b>评分依据</b>
                <p>{item.evidence || '暂无评分依据。'}</p>
              </div>
              <div>
                <b>改进建议</b>
                <p>{item.suggestion || '暂无改进建议。'}</p>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function InsightList({ title, description, items = [], emptyText, getTitle, getBody, wide = false }) {
  return (
    <section className={`table-card detail-section insight-section ${wide ? 'wide-detail' : ''}`}>
      <div className="report-list-header">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
      </div>
      {items.length ? (
        <div className="insight-list">
          {items.map((item, index) => (
            <article className="insight-item" key={`${title}-${index}`}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div>
                <b>{getTitle ? getTitle(item, index) : item}</b>
                {getBody && <p>{getBody(item, index)}</p>}
              </div>
            </article>
          ))}
        </div>
      ) : <div className="empty small">{emptyText}</div>}
    </section>
  );
}

function ReportCard({ report = {}, title = '评分预览', status }) {
  return (
    <div className="report-card">
      <div className="report-head">
        <div>
          <h2>{title}</h2>
          {status && <ReportStatus status={status} />}
        </div>
        <div className="report-score-summary">
          <span className={`score-pill ${getScoreTone(report.total_score).className}`}>{getScoreTone(report.total_score).label}</span>
          <strong>{report.total_score ?? '-'}</strong>
        </div>
      </div>
      <div className="table-wrap">
        <table className="detail-table compact-table">
          <thead>
            <tr>
              <th>维度</th>
              <th>得分</th>
              <th>摘要</th>
            </tr>
          </thead>
          <tbody>
            {(report.dimension_scores || []).map((item) => {
              const dimensionTone = getScoreTone(item.score);
              return (
                <tr key={item.dimension_id || item.name}>
                  <td data-label="维度">{item.name}</td>
                  <td data-label="得分"><span className={`score-pill ${dimensionTone.className}`}>{item.score ?? '-'}</span></td>
                  <td data-label="摘要">{item.evidence || item.suggestion || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!!(report.compliance_risks || []).length && (
        <div className="table-wrap">
          <table className="detail-table compact-table">
            <thead>
              <tr>
                <th>合规风险</th>
                <th>规则</th>
              </tr>
            </thead>
            <tbody>
              {report.compliance_risks.map((risk, index) => (
                <tr key={index}>
                  <td data-label="合规风险">{risk.phrase}</td>
                  <td data-label="规则">{risk.rule}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="table-wrap">
        <table className="detail-table compact-table">
          <thead>
            <tr>
              <th>改进建议</th>
            </tr>
          </thead>
          <tbody>
            {(report.improvement_suggestions || report.issues || []).map((item, index) => (
              <tr key={index}>
                <td data-label="改进建议">{item}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = '' }) {
  return <div className={`metric-card ${tone}`}><span>{label}</span><b>{value}</b></div>;
}

function BarRow({ label, value, max = 100 }) {
  const width = Math.max(4, Math.min(100, (Number(value || 0) / max) * 100));
  return <div className="bar-row"><span>{label}</span><div><i style={{ width: `${width}%` }} /></div><b>{value}</b></div>;
}

function SectionTitle({ icon, title, aside }) {
  return <div className="section-title">{React.cloneElement(icon, { size: 20 })}<h2>{title}</h2>{aside && <span>{aside}</span>}</div>;
}

function Field({ label, value, onChange, textarea = false, type = 'text', required = false }) {
  const Control = textarea ? 'textarea' : 'input';
  return <label className="field"><span>{label}{required && <em>*</em>}</span><Control aria-label={label} type={type} value={value || ''} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Notice({ message, kind = 'success' }) {
  return <div className={`notice ${kind}`}>{kind === 'error' ? <AlertCircle size={16} /> : <Check size={16} />}{message}</div>;
}

function FloatingToast({ message, kind = 'success', onClose }) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  function handleClose() {
    setExiting(true);
    setTimeout(() => onClose?.(), 300);
  }

  const icon = kind === 'error' ? <AlertCircle size={18} /> : kind === 'warn' ? <AlertCircle size={18} /> : <Check size={18} />;

  return createPortal(
    <div className={`floating-toast ${kind} ${visible ? 'visible' : ''} ${exiting ? 'exiting' : ''}`} onClick={handleClose}>
      <span className="floating-toast-icon">{icon}</span>
      <span className="floating-toast-msg">{message}</span>
    </div>,
    document.body
  );
}

function StatusBadge({ status }) {
  const text = { draft: '草稿', published: '已发布', offline: '已下线' }[status] || status;
  return <span className={`status ${status}`}>{text}</span>;
}

function ReportStatus({ status }) {
  return <span className={`status report-${status}`}>{reportStatusText[status] || status}</span>;
}

function getReportPayload(report = {}) {
  return report.final_report || report.ai_report || {};
}

function getScoreTone(score) {
  const value = Number(score);
  if (Number.isNaN(value)) return { label: '未评分', className: 'neutral' };
  if (value >= 90) return { label: '优秀', className: 'excellent' };
  if (value >= 80) return { label: '良好', className: 'good' };
  if (value >= 70) return { label: '达标', className: 'pass' };
  if (value >= 60) return { label: '待提升', className: 'warn' };
  return { label: '高风险', className: 'danger' };
}

function summarizeDimensions(dimensions = []) {
  if (!dimensions.length) return '';
  const ordered = [...dimensions].filter((item) => typeof item?.score === 'number').sort((a, b) => b.score - a.score);
  if (!ordered.length) return '';
  const best = ordered[0];
  const weakest = ordered[ordered.length - 1];
  if (best === weakest) return `${best.name} ${best.score} 分`;
  return `${best.name} ${best.score} 分，${weakest.name} ${weakest.score} 分`;
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}

function formatEntityId(prefix, id) {
  if (id === null || id === undefined || id === '') return '-';
  return `${prefix}-${String(id).padStart(4, '0')}`;
}

function scorePercent(score) {
  const value = Number(score);
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function formatDate(value) {
  if (!value) return '不限';
  return new Date(value).toLocaleDateString('zh-CN');
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN');
}

createRoot(document.getElementById('root')).render(<App />);
