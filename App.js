import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Image, KeyboardAvoidingView, Linking, PanResponder, Platform,
  SafeAreaView, ScrollView, StatusBar, StyleSheet, Switch, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import Svg, { Path } from 'react-native-svg';

/* ------------------------- Configuración ------------------------- */
const COUNTRY_CODE = '51'; // Perú. Cámbialo si usas otro país.
const CURRENCY = 'S/';
const EXPIRY_WARNING_DAYS = 30;
const KEY_M = 'tp_maintenances';
const KEY_L = 'tp_licenses';

const INVENTORY_OPTIONS = [
  'Equipo enciende', 'Pantalla sana', 'Con cargador', 'Con batería',
  'Sin golpes ni rayones', 'Teclado completo', 'Con accesorios / funda',
];
const LICENSE_TYPES = ['Perpetua', 'Suscripción'];

/* ------------------------- Utilidades ------------------------- */
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
};
const addDays = (iso, days) => {
  const d = new Date(iso);
  d.setDate(d.getDate() + (parseInt(days, 10) || 0));
  return d.toISOString();
};
const num = (v) => parseFloat(String(v).replace(',', '.')) || 0;
const money = (v) => `${CURRENCY} ${num(v).toFixed(2)}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const openWhatsApp = (phone, text = '') => {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return Alert.alert('Falta el número', 'Escribe el número de celular del cliente.');
  if (digits.length <= 9) digits = COUNTRY_CODE + digits;
  const url = `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  Linking.openURL(url).catch(() => Alert.alert('Error', 'No se pudo abrir WhatsApp.'));
};

const persistPhoto = async (uri) => {
  try {
    const dest = FileSystem.documentDirectory + `foto_${uid()}.jpg`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  } catch (e) {
    return uri;
  }
};

const pickPhoto = async (onDone) => {
  const choose = async (fromCamera) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permiso denegado', 'Activa el permiso en los ajustes del teléfono.');
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.6 });
    if (!res.canceled && res.assets?.length) onDone(await persistPhoto(res.assets[0].uri));
  };
  Alert.alert('Foto', 'Elige el origen', [
    { text: 'Cámara', onPress: () => choose(true) },
    { text: 'Galería', onPress: () => choose(false) },
    { text: 'Cancelar', style: 'cancel' },
  ]);
};

/* ------------------------- Componentes base ------------------------- */
const Field = ({ label, children }) => (
  <View style={{ marginBottom: 12 }}>
    <Text style={s.label}>{label}</Text>
    {children}
  </View>
);

const Input = (props) => (
  <TextInput placeholderTextColor="#999" {...props} style={[s.input, props.multiline && { minHeight: 70, textAlignVertical: 'top' }, props.style]} />
);

const Btn = ({ title, onPress, color = '#007AFF', style }) => (
  <TouchableOpacity onPress={onPress} style={[s.btn, { backgroundColor: color }, style]}>
    <Text style={s.btnText}>{title}</Text>
  </TouchableOpacity>
);

const PhoneField = ({ value, onChange }) => (
  <Field label="Número de celular">
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Input style={{ flex: 1 }} value={value} onChangeText={onChange} keyboardType="phone-pad" placeholder="999 999 999" />
      <TouchableOpacity onPress={() => openWhatsApp(value)} style={s.wa}>
        <Text style={s.btnText}>WhatsApp</Text>
      </TouchableOpacity>
    </View>
  </Field>
);

const DateField = ({ label, value, onChange, clearable }) => {
  const [show, setShow] = useState(false);
  return (
    <Field label={label}>
      <View style={{ flexDirection: 'row' }}>
        <TouchableOpacity style={[s.input, { flex: 1, justifyContent: 'center' }]} onPress={() => setShow(true)}>
          <Text style={{ color: value ? '#222' : '#999' }}>{value ? fmtDate(value) : 'Seleccionar fecha'}</Text>
        </TouchableOpacity>
        {clearable && value ? (
          <TouchableOpacity onPress={() => onChange(null)} style={[s.wa, { backgroundColor: '#999' }]}>
            <Text style={s.btnText}>Quitar</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {show && (
        <DateTimePicker
          value={value ? new Date(value) : new Date()}
          mode="date"
          onChange={(e, d) => {
            setShow(false);
            if (e.type === 'set' && d) onChange(d.toISOString());
          }}
        />
      )}
    </Field>
  );
};

const PhotoField = ({ label, uri, onChange }) => (
  <Field label={label}>
    <Btn title={uri ? 'Cambiar foto' : 'Tomar foto / Galería'} onPress={() => pickPhoto(onChange)} />
    {uri ? <Image source={{ uri }} style={s.photo} /> : null}
  </Field>
);

/* ------------------------- Firma digital ------------------------- */
const SignaturePad = ({ onChange, onDrawing }) => {
  const [paths, setPaths] = useState([]);
  const [live, setLive] = useState('');
  const pathsRef = useRef([]);
  const liveRef = useRef('');

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          onDrawing(true);
          const { locationX: x, locationY: y } = e.nativeEvent;
          liveRef.current = `M${x.toFixed(1)} ${y.toFixed(1)} L${x.toFixed(1)} ${y.toFixed(1)}`;
          setLive(liveRef.current);
        },
        onPanResponderMove: (e) => {
          const { locationX: x, locationY: y } = e.nativeEvent;
          liveRef.current += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
          setLive(liveRef.current);
        },
        onPanResponderRelease: () => {
          pathsRef.current = [...pathsRef.current, liveRef.current];
          liveRef.current = '';
          setPaths(pathsRef.current);
          setLive('');
          onChange(pathsRef.current);
          onDrawing(false);
        },
      }),
    []
  );

  const clear = () => {
    pathsRef.current = [];
    setPaths([]);
    setLive('');
    onChange([]);
  };

  return (
    <View>
      <View style={s.sigBox} {...pan.panHandlers}>
        <Svg width="100%" height="100%" pointerEvents="none">
          {paths.map((d, i) => (
            <Path key={i} d={d} stroke="#000" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {live ? <Path d={live} stroke="#000" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
        </Svg>
        {paths.length === 0 && !live && <Text style={s.sigHint}>Firme aquí con el dedo</Text>}
      </View>
      <TouchableOpacity onPress={clear} style={{ alignSelf: 'flex-end', padding: 6 }}>
        <Text style={{ color: '#dc3545', fontWeight: 'bold' }}>Borrar firma</Text>
      </TouchableOpacity>
    </View>
  );
};

/* ------------------------- Formulario: Mantenimiento ------------------------- */
const emptyM = () => ({
  clientName: '', phone: '', date: new Date().toISOString(), inventory: [], inventoryNotes: '',
  equipmentType: '', model: '', photo: null, needsImprovements: false, improvements: '',
  warrantyDays: '', price: '', signature: [],
});

const MaintenanceForm = ({ onSave, setScrollEnabled }) => {
  const [f, setF] = useState(emptyM());
  const [sigKey, setSigKey] = useState(0);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const toggleInv = (opt) =>
    setF((p) => ({
      ...p,
      inventory: p.inventory.includes(opt) ? p.inventory.filter((o) => o !== opt) : [...p.inventory, opt],
    }));
  const warrantyEnd = f.warrantyDays ? addDays(f.date, f.warrantyDays) : null;

  const save = () => {
    if (!f.clientName.trim()) return Alert.alert('Falta el nombre', 'Escribe el nombre del cliente.');
    if (!f.equipmentType.trim()) return Alert.alert('Falta el equipo', 'Indica el tipo de equipo.');
    onSave({ ...f, id: uid(), warrantyEnd, createdAt: new Date().toISOString() });
    setF(emptyM());
    setSigKey((k) => k + 1);
    Alert.alert('Guardado', 'Mantenimiento registrado correctamente.');
  };

  return (
    <View style={s.card}>
      <Text style={s.title}>Registro de Mantenimientos</Text>
      <Field label="Nombre del cliente">
        <Input value={f.clientName} onChangeText={set('clientName')} placeholder="Nombre del cliente" />
      </Field>
      <PhoneField value={f.phone} onChange={set('phone')} />
      <DateField label="Fecha de mantenimiento" value={f.date} onChange={set('date')} />

      <Text style={s.label}>Inventario / Estado inicial</Text>
      {INVENTORY_OPTIONS.map((opt) => (
        <View key={opt} style={s.row}>
          <Switch value={f.inventory.includes(opt)} onValueChange={() => toggleInv(opt)} />
          <Text style={{ marginLeft: 8 }}>{opt}</Text>
        </View>
      ))}
      <Input style={{ marginTop: 6, marginBottom: 12 }} multiline value={f.inventoryNotes} onChangeText={set('inventoryNotes')} placeholder="Otros detalles (rayones, golpes, accesorios...)" />

      <Field label="Tipo de equipo">
        <Input value={f.equipmentType} onChangeText={set('equipmentType')} placeholder="Laptop, PC de escritorio, Impresora..." />
      </Field>
      <Field label="Modelo del equipo">
        <Input value={f.model} onChangeText={set('model')} placeholder="Modelo" />
      </Field>
      <PhotoField label="Foto del mantenimiento" uri={f.photo} onChange={set('photo')} />

      <View style={[s.row, { marginBottom: 12 }]}>
        <Switch value={f.needsImprovements} onValueChange={set('needsImprovements')} />
        <Text style={{ marginLeft: 8 }}>¿Requiere mejoras o repuestos?</Text>
      </View>
      {f.needsImprovements && (
        <Input style={{ marginBottom: 12 }} multiline value={f.improvements} onChangeText={set('improvements')} placeholder="Detalle de mejoras o repuestos" />
      )}

      <Field label="Costo cobrado por el servicio">
        <Input value={f.price} onChangeText={set('price')} keyboardType="numeric" placeholder="0.00" />
      </Field>
      <Field label="Días de garantía">
        <Input value={f.warrantyDays} onChangeText={set('warrantyDays')} keyboardType="numeric" placeholder="Ej. 30" />
      </Field>
      <Text style={{ marginBottom: 12, color: '#444' }}>Fecha límite de garantía: <Text style={{ fontWeight: 'bold' }}>{warrantyEnd ? fmtDate(warrantyEnd) : '—'}</Text></Text>

      <Text style={s.label}>Firma digital del cliente</Text>
      <SignaturePad key={sigKey} onChange={set('signature')} onDrawing={(d) => setScrollEnabled(!d)} />

      <Btn title="Guardar Mantenimiento" color="#28a745" onPress={save} style={{ marginTop: 12 }} />
    </View>
  );
};

/* ------------------------- Formulario: Licencias ------------------------- */
const emptyL = () => ({
  clientName: '', phone: '', provider: '', licenseType: 'Perpetua', appName: '', licenseCode: '',
  device: '', installDate: new Date().toISOString(), expirationDate: null,
  purchasePrice: '', salePrice: '', photo: null,
});

const LicenseForm = ({ onSave }) => {
  const [f, setF] = useState(emptyL());
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  const save = () => {
    if (!f.clientName.trim()) return Alert.alert('Falta el nombre', 'Escribe el nombre del cliente.');
    if (!f.appName.trim()) return Alert.alert('Falta la aplicación', 'Indica el nombre de la aplicación.');
    onSave({ ...f, id: uid(), createdAt: new Date().toISOString() });
    setF(emptyL());
    Alert.alert('Guardado', 'Licencia registrada correctamente.');
  };

  return (
    <View style={s.card}>
      <Text style={s.title}>Instalación de Licencias en PC</Text>
      <Field label="Nombre del cliente">
        <Input value={f.clientName} onChangeText={set('clientName')} placeholder="Nombre del cliente" />
      </Field>
      <PhoneField value={f.phone} onChange={set('phone')} />
      <Field label="Proveedor (a quién se compró)">
        <Input value={f.provider} onChangeText={set('provider')} placeholder="Nombre del proveedor" />
      </Field>

      <Text style={s.label}>Tipo de licencia</Text>
      <View style={[s.row, { marginBottom: 12 }]}>
        {LICENSE_TYPES.map((t) => (
          <TouchableOpacity key={t} onPress={() => set('licenseType')(t)} style={[s.chip, f.licenseType === t && s.chipOn]}>
            <Text style={{ color: f.licenseType === t ? '#fff' : '#333', fontWeight: 'bold' }}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Field label="Nombre de la aplicación">
        <Input value={f.appName} onChangeText={set('appName')} placeholder="Ej. Office 2021, Antivirus" />
      </Field>
      <Field label="Código de licencia">
        <Input value={f.licenseCode} onChangeText={set('licenseCode')} autoCapitalize="characters" placeholder="XXXXX-XXXXX-XXXXX" />
      </Field>
      <Field label="Dispositivo / PC asociado">
        <Input value={f.device} onChangeText={set('device')} placeholder="Nombre o ID del equipo" />
      </Field>
      <DateField label="Fecha de instalación" value={f.installDate} onChange={set('installDate')} />
      <DateField label="Fecha de vencimiento (si aplica)" value={f.expirationDate} onChange={set('expirationDate')} clearable />
      <Field label="Precio de compra">
        <Input value={f.purchasePrice} onChangeText={set('purchasePrice')} keyboardType="numeric" placeholder="0.00" />
      </Field>
      <Field label="Precio de venta">
        <Input value={f.salePrice} onChangeText={set('salePrice')} keyboardType="numeric" placeholder="0.00" />
      </Field>
      <PhotoField label="Foto de registro / comprobante" uri={f.photo} onChange={set('photo')} />

      <Btn title="Guardar Licencia" color="#28a745" onPress={save} />
    </View>
  );
};

/* ------------------------- Búsqueda, alertas y resumen ------------------------- */
const daysLeft = (iso) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);

const Summary = ({ maintenances, licenses, onDelete }) => {
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();

  const licProfit = licenses.reduce((a, l) => a + (num(l.salePrice) - num(l.purchasePrice)), 0);
  const serviceIncome = maintenances.reduce((a, m) => a + num(m.price), 0);

  const expiring = licenses
    .filter((l) => l.expirationDate && daysLeft(l.expirationDate) <= EXPIRY_WARNING_DAYS)
    .sort((a, b) => new Date(a.expirationDate) - new Date(b.expirationDate));

  const renewalMsg = (l) =>
    `Hola ${l.clientName}, le saluda su técnico. Le recordamos que su licencia de ${l.appName} ` +
    `${daysLeft(l.expirationDate) < 0 ? 'venció' : 'vence'} el ${fmtDate(l.expirationDate)}. ` +
    `¿Desea que realicemos la renovación? Quedo atento a su respuesta.`;

  const fm = maintenances.filter((m) =>
    !term || [m.clientName, m.equipmentType, m.model].some((v) => (v || '').toLowerCase().includes(term)));
  const fl = licenses.filter((l) =>
    !term || [l.clientName, l.appName, l.licenseType, l.device, l.provider].some((v) => (v || '').toLowerCase().includes(term)));

  const confirmDelete = (kind, id) =>
    Alert.alert('Eliminar', '¿Eliminar este registro?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => onDelete(kind, id) },
    ]);

  return (
    <View style={s.card}>
      <Text style={s.title}>Búsqueda y Resumen</Text>
      <Input value={q} onChangeText={setQ} placeholder="Buscar por cliente, equipo o licencia..." style={{ marginBottom: 16 }} />

      <Text style={s.sub}>Resumen financiero</Text>
      <View style={s.sumBox}>
        <Text>Ganancia por licencias: <Text style={s.bold}>{money(licProfit)}</Text></Text>
        <Text>Ingresos por servicios: <Text style={s.bold}>{money(serviceIncome)}</Text></Text>
        <Text style={{ marginTop: 6, fontSize: 16 }}>Total: <Text style={[s.bold, { color: '#28a745' }]}>{money(licProfit + serviceIncome)}</Text></Text>
      </View>

      {expiring.length > 0 && (
        <View style={{ marginBottom: 16 }}>
          <Text style={[s.sub, { color: '#dc3545' }]}>⚠ Licencias por caducar</Text>
          {expiring.map((l) => {
            const d = daysLeft(l.expirationDate);
            return (
              <View key={l.id} style={[s.alert, d < 0 && { backgroundColor: '#f8d7da' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.bold}>{l.appName} — {l.clientName}</Text>
                  <Text>{d < 0 ? `Vencida hace ${-d} día(s)` : d === 0 ? 'Vence hoy' : `Vence en ${d} día(s)`} ({fmtDate(l.expirationDate)})</Text>
                </View>
                <TouchableOpacity onPress={() => openWhatsApp(l.phone, renewalMsg(l))} style={[s.wa, { backgroundColor: '#25D366' }]}>
                  <Text style={s.btnText}>Recordar</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      <Text style={s.sub}>Mantenimientos ({fm.length})</Text>
      {fm.length === 0 && <Text style={s.empty}>Sin registros</Text>}
      {fm.map((m) => (
        <View key={m.id} style={s.item}>
          <View style={{ flex: 1 }}>
            <Text style={s.bold}>{m.clientName} — {m.equipmentType} {m.model}</Text>
            <Text>Fecha: {fmtDate(m.date)}{m.warrantyEnd ? ` · Garantía hasta ${fmtDate(m.warrantyEnd)}` : ''}</Text>
            {m.needsImprovements && m.improvements ? <Text>Mejoras: {m.improvements}</Text> : null}
            {m.inventory?.length ? <Text style={{ color: '#666' }}>Inventario: {m.inventory.join(', ')}</Text> : null}
            {m.photo ? <Image source={{ uri: m.photo }} style={s.thumb} /> : null}
            {m.signature?.length ? (
              <View style={s.sigThumb}>
                <Svg width="100%" height="100%" viewBox="0 0 320 150" preserveAspectRatio="none">
                  {m.signature.map((d, i) => <Path key={i} d={d} stroke="#000" strokeWidth={2} fill="none" />)}
                </Svg>
              </View>
            ) : null}
          </View>
          <View>
            <TouchableOpacity onPress={() => openWhatsApp(m.phone)} style={[s.mini, { backgroundColor: '#25D366' }]}><Text style={s.btnText}>WA</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => confirmDelete('m', m.id)} style={[s.mini, { backgroundColor: '#dc3545' }]}><Text style={s.btnText}>✕</Text></TouchableOpacity>
          </View>
        </View>
      ))}

      <Text style={[s.sub, { marginTop: 12 }]}>Licencias ({fl.length})</Text>
      {fl.length === 0 && <Text style={s.empty}>Sin registros</Text>}
      {fl.map((l) => (
        <View key={l.id} style={s.item}>
          <View style={{ flex: 1 }}>
            <Text style={s.bold}>{l.appName} ({l.licenseType}) — {l.clientName}</Text>
            <Text>Clave: {l.licenseCode || '—'}</Text>
            <Text>PC: {l.device || '—'} · Proveedor: {l.provider || '—'}</Text>
            <Text>Instalada: {fmtDate(l.installDate)}{l.expirationDate ? ` · Vence: ${fmtDate(l.expirationDate)}` : ''}</Text>
            <Text>Ganancia: {money(num(l.salePrice) - num(l.purchasePrice))}</Text>
            {l.photo ? <Image source={{ uri: l.photo }} style={s.thumb} /> : null}
          </View>
          <View>
            <TouchableOpacity onPress={() => openWhatsApp(l.phone)} style={[s.mini, { backgroundColor: '#25D366' }]}><Text style={s.btnText}>WA</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => confirmDelete('l', l.id)} style={[s.mini, { backgroundColor: '#dc3545' }]}><Text style={s.btnText}>✕</Text></TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );
};

/* ------------------------- App ------------------------- */
export default function App() {
  const [tab, setTab] = useState('mantenimiento');
  const [maintenances, setMaintenances] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [m, l] = await Promise.all([AsyncStorage.getItem(KEY_M), AsyncStorage.getItem(KEY_L)]);
        if (m) setMaintenances(JSON.parse(m));
        if (l) setLicenses(JSON.parse(l));
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => { if (loaded) AsyncStorage.setItem(KEY_M, JSON.stringify(maintenances)); }, [maintenances, loaded]);
  useEffect(() => { if (loaded) AsyncStorage.setItem(KEY_L, JSON.stringify(licenses)); }, [licenses, loaded]);

  const onDelete = (kind, id) => {
    if (kind === 'm') setMaintenances((p) => p.filter((x) => x.id !== id));
    else setLicenses((p) => p.filter((x) => x.id !== id));
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 }}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.tabs}>
          {[['mantenimiento', 'Mantenimientos'], ['licencias', 'Licencias']].map(([k, label]) => (
            <TouchableOpacity key={k} onPress={() => setTab(k)} style={[s.tab, tab === k && s.tabOn]}>
              <Text style={[s.tabText, tab === k && { color: '#007AFF' }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <ScrollView scrollEnabled={scrollEnabled} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16 }}>
          {tab === 'mantenimiento' ? (
            <MaintenanceForm onSave={(m) => setMaintenances((p) => [m, ...p])} setScrollEnabled={setScrollEnabled} />
          ) : (
            <LicenseForm onSave={(l) => setLicenses((p) => [l, ...p])} />
          )}
          <Summary maintenances={maintenances} licenses={licenses} onDelete={onDelete} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ------------------------- Estilos ------------------------- */
const s = StyleSheet.create({
  card: { padding: 16, backgroundColor: '#f8f8f8', borderRadius: 8, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 16 },
  sub: { fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  label: { fontSize: 15, marginBottom: 4, color: '#333' },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 10, borderRadius: 5, backgroundColor: '#fff', minHeight: 44, color: '#222' },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  btn: { padding: 13, borderRadius: 5, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold' },
  wa: { backgroundColor: '#25D366', padding: 12, borderRadius: 5, marginLeft: 8, justifyContent: 'center' },
  photo: { width: '100%', height: 180, borderRadius: 6, marginTop: 8 },
  thumb: { width: 90, height: 90, borderRadius: 6, marginTop: 6 },
  sigBox: { height: 150, borderWidth: 1, borderColor: '#ccc', borderRadius: 5, backgroundColor: '#fff', justifyContent: 'center' },
  sigHint: { position: 'absolute', alignSelf: 'center', color: '#aaa' },
  sigThumb: { width: 160, height: 75, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff', marginTop: 6 },
  chip: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 20, backgroundColor: '#e5e5e5', marginRight: 8 },
  chipOn: { backgroundColor: '#007AFF' },
  tabs: { flexDirection: 'row', justifyContent: 'space-around', borderBottomWidth: 1, borderBottomColor: '#eee' },
  tab: { paddingVertical: 14, paddingHorizontal: 10, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: '#007AFF' },
  tabText: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  sumBox: { backgroundColor: '#fff', padding: 12, borderRadius: 6, marginBottom: 16, borderWidth: 1, borderColor: '#e5e5e5' },
  bold: { fontWeight: 'bold' },
  alert: { backgroundColor: '#ffeeba', padding: 10, borderRadius: 5, marginBottom: 8, flexDirection: 'row', alignItems: 'center' },
  item: { backgroundColor: '#fff', padding: 10, borderRadius: 6, marginBottom: 8, flexDirection: 'row', borderWidth: 1, borderColor: '#e5e5e5' },
  mini: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 5, marginBottom: 6, alignItems: 'center' },
  empty: { color: '#999', marginBottom: 8 },
});
