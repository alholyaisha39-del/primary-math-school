import { firebaseConfig } from './firebase-config.js';

// The primary-school app NEVER uses the middle-school Firebase project.
const isMiddleSchoolProject = firebaseConfig?.projectId === 'haya-nafis-math';
const teacherEmail = 'mona1986chem@gmail.com';
const teacherUid = 'SquvTv7Cq2cOn31ABNEZYCgxkyY2';
const isApprovedTeacher = user => Boolean(user && user.uid === teacherUid && user.email?.toLowerCase() === teacherEmail);
const configured = Boolean(firebaseConfig?.apiKey && firebaseConfig?.projectId && firebaseConfig?.appId && !isMiddleSchoolProject);
window.PRIMARY_RESULTS = [];
window.PRIMARY_QUESTIONS = [];
window.PRIMARY_RESOURCES = [];
const notify = () => window.dispatchEvent(new CustomEvent('primary-cloud-updated'));
let firebaseApp, auth, db, sdk;
let unsubResults = null;
let unsubQuestions = null;
let unsubResources = null;
let readyPromise;

const cloud = {
  configured,
  isTeacher: false,
  error: null,
  async saveResult(result) {
    await readyPromise;
    const u = auth.currentUser || await sdk.signInAnonymously(auth).then(credential => credential.user);
    if (!u.isAnonymous) throw new Error('النتائج الطلابية تُرسل بحساب زائر فقط');
    const {name,grade,topic,score,total,kind='quiz',detail='',date} = result;
    if (!['1','2','3'].includes(String(grade)) || !name || name.length < 2 || name.length > 80) throw new Error('بيانات الطالب غير صحيحة');
    await sdk.addDoc(sdk.collection(db,'attempts'), {
      name: String(name).trim().slice(0,80),
      grade: String(grade),
      topic: String(topic),
      score: Number(score),
      total: Number(total),
      kind: String(kind),
      detail: String(detail).slice(0,120),
      date: String(date || new Date().toISOString()).slice(0,32),
      certificate: kind === 'quiz',
      studentUid: u.uid,
      createdAt: sdk.serverTimestamp()
    });
  },
  async loginTeacher(email,password) {
    await readyPromise;
    if(String(email).trim().toLowerCase() !== teacherEmail) throw new Error('الدخول مخصص لبريد المعلمة المعتمد');
    const credential = await sdk.signInWithEmailAndPassword(auth,email,password);
    const user = credential.user;
    if(!isApprovedTeacher(user)) {
      await sdk.signOut(auth);
      throw new Error('هذا الحساب غير مصرح له بلوحة المعلمة');
    }
    cloud.isTeacher = true;
    listenResults();
    notify();
  },
  async logoutTeacher() {
    if(unsubResults) {unsubResults(); unsubResults=null;}
    cloud.isTeacher = false;
    window.PRIMARY_RESULTS = [];
    notify();
    if(auth) await sdk.signOut(auth);
    if(auth) await sdk.signInAnonymously(auth);
  },
  async saveQuestion(q) {
    await readyPromise;
    if(!cloud.isTeacher) throw new Error('سجلي دخول المعلمة أولًا');
    const id = String(q.id).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,64);
    if(!id) throw new Error('معرف السؤال غير صحيح');
    await sdk.setDoc(sdk.doc(db,'questions',id),{
      grade:String(q.grade), topic:String(q.topic), text:String(q.text),
      answers:q.answers.map(String), correct:String(q.correct),
      why:String(q.why), visual:String(q.visual||'✦  ★  ✦')
    });
  },
  async deleteQuestion(id) {
    await readyPromise;
    if(!cloud.isTeacher) throw new Error('الدخول محصور بالمعلمة');
    await sdk.deleteDoc(sdk.doc(db,'questions',id));
  },
  async saveResource(resource) {
    await readyPromise;
    if(!cloud.isTeacher) throw new Error('ليس لديك صلاحية إدارة المكتبة');
    const id=String(resource.id).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,64);
    if(!id) throw new Error('معرف المحتوى غير صحيح');
    const entry={grade:String(resource.grade),kind:String(resource.kind),title:String(resource.title).trim(),description:String(resource.description).trim(),url:String(resource.url).trim()};
    if(!['1','2','3'].includes(entry.grade)||!['remedial','enrichment','video'].includes(entry.kind))throw new Error('تصنيف غير صالح');
    const u=new URL(entry.url);if(u.protocol!=='https:')throw new Error('الرابط غير آمن');
    if(entry.title.length<3||entry.title.length>110||entry.description.length<3||entry.description.length>240||entry.url.length>1800)throw new Error('تحقّق من بيانات المحتوى');
    await sdk.setDoc(sdk.doc(db,'learning_resources',id),entry);
  },
  async deleteResource(id) {
    await readyPromise;
    if(!cloud.isTeacher)throw new Error('خاص بالمعلمة');
    await sdk.deleteDoc(sdk.doc(db,'learning_resources',String(id)));
  },
  async refreshResults() {
    await readyPromise;
    if (!cloud.isTeacher) return;
    const snapshot = await sdk.getDocs(sdk.query(sdk.collection(db,'attempts'),sdk.orderBy('createdAt','desc'),sdk.limit(500)));
    window.PRIMARY_RESULTS = snapshot.docs.map(d=>({id:d.id,...d.data()}));
    notify();
  }
};
window.primaryCloud = cloud;
notify();

function listenResults() {
  if(unsubResults) unsubResults();
  unsubResults = sdk.onSnapshot(
    sdk.query(sdk.collection(db,'attempts'),sdk.orderBy('createdAt','desc'),sdk.limit(500)),
    snap => {window.PRIMARY_RESULTS=snap.docs.map(d=>({id:d.id,...d.data()}));notify();},
    error => {cloud.error=error;console.error('Error reading teacher results:',error);notify();}
  );
}

async function init() {
  const [appModule, authModule, storeModule] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js')
  ]);
  sdk = {...authModule,...storeModule};
  firebaseApp = appModule.initializeApp(firebaseConfig,'primaryMath');
  auth = authModule.getAuth(firebaseApp);
  db = storeModule.getFirestore(firebaseApp);
  unsubQuestions = storeModule.onSnapshot(storeModule.collection(db,'questions'),
    snap=>{window.PRIMARY_QUESTIONS=snap.docs.map(d=>({id:d.id,...d.data()}));notify()},
    error=>{cloud.error=error;console.error('Could not read questions:',error);notify()});
  unsubResources=storeModule.onSnapshot(storeModule.collection(db,'learning_resources'),
    snap=>{window.PRIMARY_RESOURCES=snap.docs.map(d=>({id:d.id,...d.data()}));notify();},
    error=>{cloud.error=error;console.error('Could not read learning resources:',error);notify()});
  authModule.onAuthStateChanged(auth, async user => {
    if (!user || user.isAnonymous) {
      if(unsubResults) {unsubResults();unsubResults=null;}
      cloud.isTeacher=false;
      window.PRIMARY_RESULTS=[];
      notify();
      return;
    }
    cloud.isTeacher=isApprovedTeacher(user);
    if(cloud.isTeacher) listenResults();
    else {
      if(unsubResults) {unsubResults();unsubResults=null;}
      window.PRIMARY_RESULTS=[];
    }
    notify();
  });
  // Students enter with anonymous Firebase Auth; no personal login is required.
  if(!auth.currentUser)await authModule.signInAnonymously(auth);
}

readyPromise = configured ? init().catch(error=>{cloud.error=error;notify();throw error}) : Promise.reject(new Error(isMiddleSchoolProject ? 'هذا إعداد مشروع المتوسط! أنشئي مشروعًا مستقلًا للابتدائي.' : 'مشروع Firebase الابتدائي غير مربوط بعد'));
readyPromise.catch(()=>{});
