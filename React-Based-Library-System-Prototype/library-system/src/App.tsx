import { useState } from "react";
import type { ChangeEvent } from "react";
import {
  FileSpreadsheet,
  Download,
  Database,
  GraduationCap,
  Heart,
  Search,
  Clock,
} from "lucide-react";
import Papa from "papaparse";
import type { ParseResult } from "papaparse";
import * as XLSX from "xlsx";


type TallyMap = Record<string, number>;
type DateTallyMap = Record<string, TallyMap>;
type Row = (string | number | null | undefined)[];


const FIND_DAY_SCAN_ROWS = 12;


const HOUR_TO_SLOT: Record<number, string> = {
  7:  "7:00-8:00",
  8:  "8:00-9:00",
  9:  "9:00-10:00",
  10: "10:00-11:00",
  11: "11:00-12:00",
  12: "12:00-1:00",
  13: "1:00-2:00",
  14: "2:00-3:00",
  15: "3:00-4:00",
  16: "4:00-5:00",
  17: "5:00-6:00",
  18: "6:00-7:00",
  19: "7:00-8:00_EVE",
  20: "8:00-9:00_EVE",
};

const slotDisplayLabel = (slot: string) => slot.replace("_EVE", "");


const PROGRAM_ALIASES: Record<string, string> = {
  MKT: "MARKETING",
  MSE: "MEMSE",
};



const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

const toISODate = (raw: unknown): string | null => {
  if (!raw) return null;
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null;
    return `${raw.getFullYear()}-${pad(raw.getMonth() + 1)}-${pad(raw.getDate())}`;
  }
  const s = String(raw).trim();
  const token = s.split(/[ T]/)[0];

  const mIso = token.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mIso) {
    const y = +mIso[1], mo = +mIso[2], d = +mIso[3];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31)
      return `${y}-${pad(mo)}-${pad(d)}`;
  }

  const mSlash = token.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mSlash) {
    let y = +mSlash[3];
    if (y < 100) y += 2000;
    const a = +mSlash[1], b = +mSlash[2];
    const month = a <= 12 ? a : b;
    const day   = a <= 12 ? b : a;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31)
      return `${y}-${pad(month)}-${pad(day)}`;
  }

  const MONTHS: Record<string, number> = {
    jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,
    jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,
    oct:10,october:10,nov:11,november:11,dec:12,december:12,
  };
  const mName = token.replace(",", "").match(/^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/);
  if (mName) {
    const mo = MONTHS[mName[1].toLowerCase()], d = +mName[2], y = +mName[3];
    if (mo && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
  }

  const dtry = new Date(token);
  if (!isNaN(dtry.getTime()))
    return `${dtry.getFullYear()}-${pad(dtry.getMonth() + 1)}-${pad(dtry.getDate())}`;

  return null;
};

const datesBetween = (startISO: string, endISO: string): string[] => {
  const out: string[] = [];
  if (!startISO || !endISO) return out;
  const s = new Date(startISO), e = new Date(endISO);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || s > e) return out;
  const cur = new Date(s);
  while (cur <= e) {
    out.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
};

const dayFromISO = (iso: string): number => +iso.split("-")[2];


const findDayColumnIndex = (sheet: Row[], dayValue: number): number => {
  const limit = Math.min(sheet.length, FIND_DAY_SCAN_ROWS);
  for (let r = 0; r < limit; r++) {
    const row = sheet[r] || [];
    const idx = row.findIndex((cell: unknown, c: number) => {
      if (c === 0) return false;
      const n = parseFloat(String(cell).trim());
      return !isNaN(n) && n === dayValue;
    });
    if (idx !== -1) return idx;
  }
  return -1;
};

const formatRangeSuffix = (start: string, end: string): string =>
  `${start}_to_${end}`;

const normalizeProgram = (s: unknown): string => {
  const trimmed = String(s || "").trim();
  const key = trimmed.replace(/\s+/g, "").toUpperCase();
  return PROGRAM_ALIASES[key] || trimmed.toUpperCase();
};

const parseHour = (timeStr: unknown): number | null => {
  if (!timeStr) return null;
  const s = String(timeStr).trim().toUpperCase();
  const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (m12) {
    let h = +m12[1];
    if (m12[3] === "PM" && h !== 12) h += 12;
    if (m12[3] === "AM" && h === 12) h = 0;
    return h;
  }
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) return +m24[1];
  return null;
};

const hourToSlotKey = (hour: number | null): string | null =>
  hour !== null ? (HOUR_TO_SLOT[hour] ?? null) : null;


const recomputeProgramTotals = (sheet: Row[]): void => {
  const HEADER_ROW = 1;
  const header = sheet[HEADER_ROW] || [];
  const totalCol = header.findIndex(
    (c) => String(c).trim().toLowerCase() === "total"
  );
  if (totalCol === -1) return;

  const dayCols: number[] = [];
  for (let c = 1; c < totalCol; c++) dayCols.push(c);

  for (let r = HEADER_ROW + 1; r < sheet.length; r++) {
    const label = String(sheet[r][0] || "").trim().toUpperCase();
   
    if (label === "SUMMARY" || label === "TIME") break;
 
    if (!label || label === "TOTAL") continue;

    let sum = 0;
    dayCols.forEach((c) => {
      const v = parseFloat(String(sheet[r][c] ?? "").trim());
      if (!isNaN(v)) sum += v;
    });
    sheet[r][totalCol] = sum || "";
  }
};


const recomputeTimeTotals = (sheet: Row[]): void => {
  const timeHeaderIdx = sheet.findIndex(
    (row) => String(row[0] || "").trim().toUpperCase() === "TIME"
  );
  if (timeHeaderIdx === -1) return;

  const header = sheet[timeHeaderIdx] || [];
  const totalCol = header.findIndex(
    (c) => String(c).trim().toLowerCase() === "total"
  );
  if (totalCol === -1) return;

  const dayCols: number[] = [];
  for (let c = 1; c < totalCol; c++) dayCols.push(c);

  for (let r = timeHeaderIdx + 1; r < sheet.length; r++) {
    const label = String(sheet[r][0] || "").trim().toUpperCase();
    if (!label) continue;

    let sum = 0;
    dayCols.forEach((c) => {
      const v = parseFloat(String(sheet[r][c] ?? "").trim());
      if (!isNaN(v)) sum += v;
    });
    sheet[r][totalCol] = sum || "";
  }
};



const readAsArrayBuffer = (file: File): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(new Error("FileReader error"));
    r.readAsArrayBuffer(file);
  });


const parseFileToRows = async (
  file: File,
  skipEmpty = true
): Promise<Row[]> => {
  const isCsv  = /\.csv$/i.test(file.name);
  const isXlsx = /\.xlsx?$/i.test(file.name);

  if (isCsv) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: false,
        skipEmptyLines: skipEmpty,
        complete: (results: ParseResult<Row>) => resolve(results.data),
        error:   (err: Error) => reject(err),
      });
    });
  }

  if (isXlsx) {
    const buf = await readAsArrayBuffer(file);
    const wb  = XLSX.read(buf, { type: "array", cellDates: true });
    const sheetName = wb.SheetNames.includes("Report")
      ? "Report"
      : wb.SheetNames[0];
    const ws   = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, {
      header:    1,
      blankrows: !skipEmpty,
      raw:       false,
      dateNF:    "yyyy-mm-dd hh:mm:ss",
    }) as Row[];
    return rows;
  }

  throw new Error("Unsupported file type — please upload .csv or .xlsx");
};

const downloadCSV = (sheet: Row[], filename: string): void => {
  const csv  = Papa.unparse(sheet);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.setAttribute("download", filename);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};


export default function App() {
  const [tallies,           setTallies]          = useState<TallyMap>({});
  const [timeTallies,       setTimeTallies]       = useState<TallyMap>({});
  const [masterRows,        setMasterRows]        = useState<Row[]>([]);
  const [logFileName,       setLogFileName]       = useState<string>("");
  const [masterFileName,    setMasterFileName]    = useState<string>("");
  const [detectedDate,      setDetectedDate]      = useState<string>("");
  const [talliesByDate,     setTalliesByDate]     = useState<DateTallyMap>({});
  const [timeTalliesByDate, setTimeTalliesByDate] = useState<DateTallyMap>({});
  const [availableDates,    setAvailableDates]    = useState<string[]>([]);
  const [dateRange,         setDateRange]         = useState<{ start: string; end: string }>({ start: "", end: "" });
  const [activeTab,         setActiveTab]         = useState<"programs" | "time">("programs");

 
  const handleLogUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogFileName(file.name);

    let rawData: Row[];
    try {
      rawData = await parseFileToRows(file, true);
    } catch (err) {
      return alert((err as Error)?.message ?? String(err));
    }


    const headerIdx = rawData.findIndex(
      (row) =>
        row?.some((c) => String(c).toLowerCase().includes("program")) &&
        row?.some((c) => String(c).toLowerCase().includes("date"))
    );
    if (headerIdx === -1)
      return alert("Could not find 'Program' and 'Date' columns in the log file.");

    const hdr     = rawData[headerIdx];
    const progIdx = hdr.findIndex((c) => String(c).toLowerCase().includes("program"));
    const dateIdx = hdr.findIndex((c) => String(c).toLowerCase().includes("date"));
    const timeIdx = hdr.findIndex((c) => String(c).toLowerCase().includes("time"));

    const countsByDate:     DateTallyMap = {};
    const timeCountsByDate: DateTallyMap = {};
    const seen = new Set<string>();

    rawData.slice(headerIdx + 1).forEach((row) => {
      const iso  = toISODate(row?.[dateIdx]);
      const prog = normalizeProgram(row?.[progIdx]);
      if (!iso || !prog || prog === "PROGRAM") return;


      if (!countsByDate[iso]) countsByDate[iso] = {};
      countsByDate[iso][prog] = (countsByDate[iso][prog] || 0) + 1;
      seen.add(iso);

  
      if (timeIdx !== -1) {
        const slot = hourToSlotKey(parseHour(row?.[timeIdx]));
        if (slot) {
          if (!timeCountsByDate[iso]) timeCountsByDate[iso] = {};
          timeCountsByDate[iso][slot] = (timeCountsByDate[iso][slot] || 0) + 1;
        }
      }
    });

    const sorted = Array.from(seen).sort();
    setAvailableDates(sorted);
    setTalliesByDate(countsByDate);
    setTimeTalliesByDate(timeCountsByDate);

    const first = sorted[0] || "";
    setDetectedDate(first);
    setTallies(first ? countsByDate[first] || {} : {});
    setTimeTallies(first ? timeCountsByDate[first] || {} : {});
  };


  const handleMasterUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMasterFileName(file.name);

    let rows: Row[];
    try {
   
      rows = await parseFileToRows(file, false);
    } catch (err) {
      return alert((err as Error)?.message ?? String(err));
    }
    setMasterRows(rows);
  };

  const handleDateSelect = (iso: string) => {
    setDetectedDate(iso);
    setTallies(talliesByDate[iso] || {});
    setTimeTallies(timeTalliesByDate[iso] || {});
  };

 
  const buildFilledSheet = (
    days: string[]
  ): { newSheet: Row[]; missing: number[] } => {
    const newSheet: Row[] = masterRows.map((row) => [...row]);
    const missing: number[] = [];

    days.forEach((iso) => {
      const dayValue     = dayFromISO(iso);
      const dateColIndex = findDayColumnIndex(newSheet, dayValue);
      if (dateColIndex === -1) { missing.push(dayValue); return; }

      const progMap: TallyMap = talliesByDate[iso]     || {};
      const timeMap: TallyMap = timeTalliesByDate[iso] || {};


      const slotOccurrenceSeen: Record<string, number> = {};

      newSheet.forEach((row, rowIndex) => {
        const rawLabel = String(row[0] || "").trim();
        const labelUp  = rawLabel.toUpperCase();

 
        if (
          !rawLabel ||
          labelUp === "PROGRAM" ||
          labelUp === "SUMMARY" ||
          labelUp === "TIME" ||
          labelUp === "TOTAL"
        ) return;

      
        const isTimeSlot = Object.values(HOUR_TO_SLOT).some(
          (s) => s.replace("_EVE", "") === rawLabel
        );

        if (isTimeSlot) {
          slotOccurrenceSeen[rawLabel] = (slotOccurrenceSeen[rawLabel] || 0) + 1;
        
          const slotKey =
            slotOccurrenceSeen[rawLabel] === 1
              ? rawLabel
              : `${rawLabel}_EVE`;

          const count = timeMap[slotKey] ?? 0;
          if (count) newSheet[rowIndex][dateColIndex] = count;
          return;
        }

  
        const masterProg = normalizeProgram(rawLabel);
        const count = progMap[masterProg] ?? 0;
        if (count) newSheet[rowIndex][dateColIndex] = count;
      });
    });


    recomputeProgramTotals(newSheet);
    recomputeTimeTotals(newSheet);

    return { newSheet, missing };
  };

  
  const processAndDownload = () => {
    if (masterRows.length === 0 || !detectedDate)
      return alert("Upload both files first.");

    const { newSheet, missing } = buildFilledSheet([detectedDate]);
    if (missing.length)
      alert(`Day column not found in Master for day(s): ${missing.join(", ")}`);

    downloadCSV(newSheet, `Library_Mapua_Report_${dayFromISO(detectedDate)}.csv`);
  };

  
  const processAndDownloadRange = () => {
    if (masterRows.length === 0) return alert("Upload the Master Template first.");
    if (!dateRange.start || !dateRange.end) return alert("Pick a start and end date.");
    if (Object.keys(talliesByDate).length === 0) return alert("Upload the daily log first.");

    const days = datesBetween(dateRange.start, dateRange.end);
    if (!days.length) return alert("Date range is invalid or empty.");

    const { newSheet, missing } = buildFilledSheet(days);
    if (missing.length)
      alert(
        `Day columns not found in Master for: ${missing.join(", ")}. ` +
        `Check header rows or increase FIND_DAY_SCAN_ROWS.`
      );

    downloadCSV(
      newSheet,
      `Library_Mapua_Report_${formatRangeSuffix(dateRange.start, dateRange.end)}.csv`
    );
  };

  
  const downloadMasterRangeOnly = () => {
    if (masterRows.length === 0) return alert("Upload the Master Template first.");
    if (!dateRange.start || !dateRange.end) return alert("Pick a start and end date.");

    const days = datesBetween(dateRange.start, dateRange.end);
    if (!days.length) return alert("Date range is invalid or empty.");

    const colsToKeep = new Set<number>([0]);
    days.forEach((iso) => {
      const idx = findDayColumnIndex(masterRows, dayFromISO(iso));
      if (idx !== -1) colsToKeep.add(idx);
    });

    const filtered = masterRows.map((row) =>
      row.filter((_: unknown, c: number) => colsToKeep.has(c))
    );

    downloadCSV(
      filtered,
      `Master_RangeOnly_${formatRangeSuffix(dateRange.start, dateRange.end)}.csv`
    );
  };

 
  const totalStudents = Object.values(tallies).reduce((a, b) => a + b, 0);

  const totalInRange =
    dateRange.start && dateRange.end
      ? datesBetween(dateRange.start, dateRange.end).reduce(
          (acc, iso) =>
            acc + Object.values(talliesByDate[iso] || {}).reduce((a, b) => a + b, 0),
          0
        )
      : 0;

  const peakTimeSlot = Object.entries(timeTallies).sort((a, b) => b[1] - a[1])[0];

  
  return (
    <div className="min-h-screen relative" style={{ fontFamily: "'Georgia', serif" }}>

  
      <div
        className="fixed inset-0"
        style={{
          backgroundImage: "url('/mapua-campus-bg.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />
   
      <div className="fixed inset-0" style={{ background: "rgba(5,5,12,0.82)" }} />
    
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(180,0,0,0.04) 1px, transparent 1px)," +
            "linear-gradient(90deg, rgba(180,0,0,0.04) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto px-4 py-8">

 
        <header className="mb-10 pb-6 border-b border-red-900/30">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(180,0,0,0.3)", border: "1px solid rgba(220,38,38,0.5)" }}
                >
                  <GraduationCap size={16} className="text-red-400" />
                </div>
                <span
                  className="text-xs tracking-[0.4em] uppercase"
                  style={{ color: "#e2b04a" }}
                >
                  Mapua Makati Library
                </span>
              </div>
              <h1
                className="text-4xl font-bold leading-none"
                style={{ color: "#f0f0f0", letterSpacing: "-0.02em" }}
              >
                Library <span style={{ color: "#dc2626" }}>Analytics</span>
                <span className="text-base ml-3 font-normal italic" style={{ color: "#666" }}>
                  System
                </span>
              </h1>
            </div>
            <div
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
                color: "#ffffff",
                fontFamily: "'Courier New', monospace",
              }}
            >
              <Heart size={10} fill="#dc2626" className="text-red-600" />
              Developed by Acpal, Argueza, Francisco III, Aquino, Lauguico
            </div>
          </div>
        </header>

     
        {(totalStudents > 0 || availableDates.length > 0) && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            {(
              [
                { label: "Students Today",  value: totalStudents,               accent: "#dc2626" },
                { label: "Dates in Log",    value: availableDates.length,       accent: "#e2b04a" },
                { label: "Programs",        value: Object.keys(tallies).length, accent: "#22c55e" },
                {
                  label: peakTimeSlot
                    ? `Peak: ${slotDisplayLabel(peakTimeSlot[0])}`
                    : "Peak Hour",
                  value: peakTimeSlot ? peakTimeSlot[1] : "—",
                  accent: "#8b5cf6",
                },
              ] as { label: string; value: string | number; accent: string }[]
            ).map(({ label, value, accent }) => (
              <div
                key={label}
                className="rounded-xl p-4"
                style={{
                  background: "rgba(255,255,255,0.025)",
                  border: `1px solid ${accent}22`,
                  backdropFilter: "blur(8px)",
                }}
              >
                <div
                  className="text-2xl font-bold"
                  style={{ color: accent, fontFamily: "'Courier New', monospace" }}
                >
                  {value}
                </div>
                <div className="text-xs mt-1" style={{ color: "#ffffff" }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

     
          <div className="lg:col-span-4 space-y-5">

        
            <div
              className="rounded-2xl p-6"
              style={{
                background: "rgba(10,10,18,0.75)",
                border: "1px solid rgba(255,255,255,0.07)",
                backdropFilter: "blur(12px)",
              }}
            >
              <h2
                className="text-xs uppercase tracking-widest mb-5 pb-3 border-b"
                style={{
                  color: "#e2b04a",
                  fontFamily: "'Courier New', monospace",
                  borderColor: "rgba(255,255,255,0.07)",
                }}
              >
                File Inputs
              </h2>
              <div className="space-y-4">
       
                <label className="block cursor-pointer group">
                  <span
                    className="text-xs uppercase tracking-widest"
                    style={{ color: "#dc2626", fontFamily: "'Courier New', monospace" }}
                  >
                    Daily Log (.csv or .xlsx)
                  </span>
                  <div
                    className="mt-2 p-4 rounded-xl flex items-center gap-3 transition-all group-hover:border-red-600"
                    style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <Database size={18} className="text-red-500 shrink-0" />
                    <span
                      className="text-xs truncate italic"
                      style={{ color: logFileName ? "#ccc" : "#444", fontFamily: "'Courier New', monospace" }}
                    >
                      {logFileName || "Click to upload…"}
                    </span>
                    {availableDates.length > 0 && (
                      <span
                        className="ml-auto shrink-0 text-xs px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(220,38,38,0.2)", color: "#dc2626" }}
                      >
                        {availableDates.length}d
                      </span>
                    )}
                  </div>
                  <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleLogUpload} />
                </label>

    
                <label className="block cursor-pointer group">
                  <span
                    className="text-xs uppercase tracking-widest"
                    style={{ color: "#888", fontFamily: "'Courier New', monospace" }}
                  >
                    Master Template (.csv or .xlsx)
                  </span>
                  <div
                    className="mt-2 p-4 rounded-xl flex items-center gap-3 transition-all group-hover:border-yellow-500"
                    style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <FileSpreadsheet size={18} className="text-yellow-500 shrink-0" />
                    <span
                      className="text-xs truncate italic"
                      style={{ color: masterFileName ? "#ccc" : "#444", fontFamily: "'Courier New', monospace" }}
                    >
                      {masterFileName || "Click to upload…"}
                    </span>
                    {masterRows.length > 0 && (
                      <span
                        className="ml-auto shrink-0 text-xs px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(234,179,8,0.15)", color: "#e2b04a" }}
                      >
                        {masterRows.length}r
                      </span>
                    )}
                  </div>
                  <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleMasterUpload} />
                </label>
              </div>
            </div>

    
            {availableDates.length > 0 && (
              <div
                className="rounded-2xl p-6"
                style={{
                  background: "rgba(10,10,18,0.75)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  backdropFilter: "blur(12px)",
                }}
              >
                <div className="flex items-center justify-between mb-4">
                  <h2
                    className="text-xs uppercase tracking-widest"
                    style={{ color: "#888", fontFamily: "'Courier New', monospace" }}
                  >
                    Preview Date
                  </h2>
                  {detectedDate && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-md"
                      style={{
                        background: "rgba(220,38,38,0.15)",
                        color: "#f87171",
                        fontFamily: "'Courier New', monospace",
                        border: "1px solid rgba(220,38,38,0.3)",
                      }}
                    >
                      {detectedDate}
                    </span>
                  )}
                </div>

                {(() => {
           
                  const byMonth: Record<string, string[]> = {};
                  availableDates.forEach((iso) => {
                    const key = iso.slice(0, 7);
                    if (!byMonth[key]) byMonth[key] = [];
                    byMonth[key].push(iso);
                  });
                  const monthKeys = Object.keys(byMonth).sort();
                  const MONTH_NAMES = [
                    "Jan","Feb","Mar","Apr","May","Jun",
                    "Jul","Aug","Sep","Oct","Nov","Dec",
                  ];
                  const selectedMonth = detectedDate ? detectedDate.slice(0, 7) : monthKeys[0];
                  const daysInSelectedMonth = byMonth[selectedMonth] || [];

                  return (
                    <>
           
                      <div
                        className="flex gap-1 mb-3 overflow-x-auto pb-1"
                        style={{ scrollbarWidth: "none" }}
                      >
                        {monthKeys.map((mk) => {
                          const [y, m] = mk.split("-");
                          const label = `${MONTH_NAMES[+m - 1]} '${y.slice(2)}`;
                          const isActive = mk === selectedMonth;
                          return (
                            <button
                              key={mk}
                              onClick={() => {
                 
                                const first = byMonth[mk][0];
                                handleDateSelect(first);
                              }}
                              className="shrink-0 px-3 py-1.5 rounded-lg text-xs transition-all"
                              style={{
                                fontFamily: "'Courier New', monospace",
                                background: isActive
                                  ? "rgba(220,38,38,0.22)"
                                  : "rgba(255,255,255,0.04)",
                                border: `1px solid ${isActive ? "rgba(220,38,38,0.55)" : "rgba(255,255,255,0.07)"}`,
                                color: isActive ? "#f87171" : "#555",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>

    
                      <div className="grid grid-cols-7 gap-1">
                        {daysInSelectedMonth.map((iso) => {
                          const day = +iso.split("-")[2];
                          const isSelected = iso === detectedDate;
                          return (
                            <button
                              key={iso}
                              onClick={() => handleDateSelect(iso)}
                              className="rounded-md py-1.5 text-xs font-bold transition-all"
                              style={{
                                fontFamily: "'Courier New', monospace",
                                background: isSelected
                                  ? "rgba(220,38,38,0.3)"
                                  : "rgba(255,255,255,0.04)",
                                border: `1px solid ${isSelected ? "rgba(220,38,38,0.7)" : "rgba(255,255,255,0.06)"}`,
                                color: isSelected ? "#fff" : "#555",
                                boxShadow: isSelected
                                  ? "0 0 8px rgba(220,38,38,0.3)"
                                  : "none",
                              }}
                            >
                              {day}
                            </button>
                          );
                        })}
                      </div>

               
                      <p
                        className="text-xs mt-3"
                        style={{ color: "#444", fontFamily: "'Courier New', monospace" }}
                      >
                        {daysInSelectedMonth.length} day{daysInSelectedMonth.length !== 1 ? "s" : ""} with data
                        {monthKeys.length > 1 && ` · ${monthKeys.length} months total`}
                      </p>
                    </>
                  );
                })()}
              </div>
            )}

          
            <div
              className="rounded-2xl p-6"
              style={{
                background: "rgba(10,10,18,0.75)",
                border: "1px solid rgba(255,255,255,0.07)",
                backdropFilter: "blur(12px)",
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <h2
                  className="text-xs uppercase tracking-widest"
                  style={{ color: "#888", fontFamily: "'Courier New', monospace" }}
                >
                  Date Range Export
                </h2>
                {availableDates.length > 0 && (
                  <span className="text-xs" style={{ color: "#555" }}>
                    {availableDates[0]} → {availableDates[availableDates.length - 1]}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                {(["start", "end"] as const).map((key) => (
                  <div key={key}>
                    <label
                      className="text-xs capitalize"
                      style={{ color: "#555", fontFamily: "'Courier New', monospace" }}
                    >
                      {key}
                    </label>
                    <input
                      type="date"
                      className="mt-1 w-full rounded-lg px-3 py-2 text-sm"
                      style={{
                        background: "rgba(0,0,0,0.4)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        color: "#ccc",
                        outline: "none",
                        colorScheme: "dark",
                      }}
                      value={dateRange[key]}
                      min={
                        key === "end"
                          ? dateRange.start || availableDates[0] || undefined
                          : availableDates[0] || undefined
                      }
                      max={availableDates[availableDates.length - 1] || undefined}
                      onChange={(e) =>
                        setDateRange((r) => ({ ...r, [key]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <button
                  onClick={processAndDownloadRange}
                  disabled={
                    !dateRange.start ||
                    !dateRange.end ||
                    masterRows.length === 0 ||
                    Object.keys(talliesByDate).length === 0
                  }
                  className="w-full py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-30"
                  style={{
                    background: "linear-gradient(135deg,#b91c1c,#dc2626)",
                    color: "#fff",
                    fontFamily: "'Courier New', monospace",
                    boxShadow: "0 0 20px rgba(220,38,38,0.2)",
                  }}
                >
                  <Download size={13} className="inline mr-2" />
                  Generate Report (Range)
                </button>

                <button
                  onClick={downloadMasterRangeOnly}
                  disabled={!dateRange.start || !dateRange.end || masterRows.length === 0}
                  className="w-full py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-30"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    color: "#888",
                    border: "1px solid rgba(255,255,255,0.08)",
                    fontFamily: "'Courier New', monospace",
                  }}
                >
                  Master (Range Only)
                </button>
              </div>
            </div>

          
            {detectedDate && masterRows.length > 0 && (
              <button
                onClick={processAndDownload}
                className="w-full py-4 rounded-2xl text-sm font-bold uppercase tracking-widest transition-all"
                style={{
                  background: "linear-gradient(135deg,#e2b04a,#d97706)",
                  color: "#000",
                  fontFamily: "'Courier New', monospace",
                  boxShadow: "0 0 24px rgba(226,176,74,0.25)",
                }}
              >
                <Download size={15} className="inline mr-2" />
                Generate Report ({detectedDate.split("-").slice(1).join("/")})
              </button>
            )}
          </div>

      
          <div className="lg:col-span-8">
            <div
              className="rounded-2xl overflow-hidden h-full"
              style={{
                background: "rgba(0,0,0,0.6)",
                border: "1px solid rgba(255,255,255,0.06)",
                backdropFilter: "blur(16px)",
                minHeight: "520px",
              }}
            >
          
              <div
                className="px-8 py-5 flex items-center justify-between"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="w-2 h-2 rounded-full animate-pulse"
                    style={{ background: "#dc2626", boxShadow: "0 0 8px #dc2626" }}
                  />
                  <span
                    className="text-sm font-bold uppercase tracking-widest"
                    style={{ color: "#f0f0f0", fontFamily: "'Courier New', monospace" }}
                  >
                    Analytics
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  {detectedDate && (
                    <span
                      className="text-xs px-3 py-1 rounded-lg"
                      style={{
                        background: "rgba(226,176,74,0.1)",
                        border: "1px solid rgba(226,176,74,0.2)",
                        color: "#e2b04a",
                        fontFamily: "'Courier New', monospace",
                      }}
                    >
                      {detectedDate}
                    </span>
                  )}

                  {(Object.keys(tallies).length > 0 || Object.keys(timeTallies).length > 0) && (
                    <div
                      className="flex rounded-lg overflow-hidden"
                      style={{ border: "1px solid rgba(255,255,255,0.07)" }}
                    >
                      {(["programs", "time"] as const).map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setActiveTab(tab)}
                          className="px-3 py-1.5 text-xs transition-all"
                          style={{
                            fontFamily: "'Courier New', monospace",
                            background:
                              activeTab === tab
                                ? tab === "programs"
                                  ? "rgba(220,38,38,0.2)"
                                  : "rgba(139,92,246,0.2)"
                                : "transparent",
                            color:
                              activeTab === tab
                                ? tab === "programs" ? "#f87171" : "#a78bfa"
                                : "#555",
                          }}
                        >
                          {tab === "time" && <Clock size={11} className="inline mr-1" />}
                          {tab === "programs" ? "Programs" : "Hourly"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

            
              <div className="p-8 overflow-y-auto" style={{ maxHeight: "580px" }}>
                {activeTab === "programs" && Object.keys(tallies).length > 0 ? (
                  <>
              
                    <div className="mb-6 space-y-2">
                      {Object.entries(tallies)
                        .sort((a, b) => b[1] - a[1])
                        .map(([prog, count]) => {
                          const pct = totalStudents
                            ? Math.round((count / totalStudents) * 100)
                            : 0;
                          return (
                            <div key={prog} className="flex items-center gap-3">
                              <span
                                className="w-20 text-right text-xs shrink-0"
                                style={{ color: "#666", fontFamily: "'Courier New', monospace" }}
                              >
                                {prog}
                              </span>
                              <div
                                className="flex-1 rounded-full overflow-hidden"
                                style={{ background: "rgba(255,255,255,0.04)", height: "10px" }}
                              >
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${pct}%`,
                                    background: "linear-gradient(90deg,#b91c1c,#ef4444)",
                                    boxShadow: "0 0 8px rgba(220,38,38,0.4)",
                                  }}
                                />
                              </div>
                              <span
                                className="w-10 text-right text-xs shrink-0"
                                style={{ color: "#f87171", fontFamily: "'Courier New', monospace" }}
                              >
                                {count}
                              </span>
                            </div>
                          );
                        })}
                    </div>

                  
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {Object.entries(tallies)
                        .sort((a, b) => b[1] - a[1])
                        .map(([prog, count]) => (
                          <div
                            key={prog}
                            className="flex justify-between items-center p-4 rounded-xl"
                            style={{
                              background: "rgba(255,255,255,0.03)",
                              border: "1px solid rgba(255,255,255,0.05)",
                            }}
                          >
                            <span className="text-xs" style={{ color: "#555", fontFamily: "'Courier New', monospace" }}>
                              {prog}
                            </span>
                            <span className="text-lg font-bold" style={{ color: "#f0f0f0", fontFamily: "'Courier New', monospace" }}>
                              {count}
                            </span>
                          </div>
                        ))}
                    </div>
                  </>
                ) : activeTab === "time" && Object.keys(timeTallies).length > 0 ? (
                  <>
                    <p className="text-xs mb-4" style={{ color: "#555", fontFamily: "'Courier New', monospace" }}>
                      Students per hour — {detectedDate}
                    </p>
                    <div className="space-y-2">
                      {Object.entries(timeTallies)
                        .sort((a, b) => {
                        
                          const toSort = (k: string) => {
                            const h = parseInt(k.replace("_EVE", ""));
                            return k.endsWith("_EVE") ? h + 100 : h;
                          };
                          return toSort(a[0]) - toSort(b[0]);
                        })
                        .map(([slot, count]) => {
                          const maxVal = Math.max(...Object.values(timeTallies));
                          const pct = maxVal ? Math.round((count / maxVal) * 100) : 0;
                          return (
                            <div key={slot} className="flex items-center gap-3">
                              <span
                                className="w-32 text-right text-xs shrink-0"
                                style={{ color: "#666", fontFamily: "'Courier New', monospace" }}
                              >
                                {slotDisplayLabel(slot)}
                                {slot.endsWith("_EVE") && (
                                  <span style={{ color: "#8b5cf6" }}> eve</span>
                                )}
                              </span>
                              <div
                                className="flex-1 rounded-full overflow-hidden"
                                style={{ background: "rgba(255,255,255,0.04)", height: "10px" }}
                              >
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${pct}%`,
                                    background: "linear-gradient(90deg,#5b21b6,#8b5cf6)",
                                    boxShadow: "0 0 8px rgba(139,92,246,0.4)",
                                  }}
                                />
                              </div>
                              <span
                                className="w-10 text-right text-xs shrink-0"
                                style={{ color: "#a78bfa", fontFamily: "'Courier New', monospace" }}
                              >
                                {count}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </>
                ) : (
                  <div className="h-80 flex flex-col items-center justify-center">
                    <Search size={40} style={{ color: "#222" }} />
                    <p className="text-xs mt-4 tracking-widest uppercase" style={{ color: "#333", fontFamily: "'Courier New', monospace" }}>
                      No data — upload a log file
                    </p>
                  </div>
                )}
              </div>

             
              {totalInRange > 0 && (
                <div
                  className="px-8 py-4 flex items-center justify-between"
                  style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                >
                  <span className="text-xs" style={{ color: "#444" }}>Range total</span>
                  <span className="text-sm font-bold" style={{ color: "#e2b04a", fontFamily: "'Courier New', monospace" }}>
                    {totalInRange.toLocaleString()} students
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}