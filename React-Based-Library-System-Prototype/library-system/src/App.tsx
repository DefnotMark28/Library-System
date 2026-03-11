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
  Calendar,
  Trophy,
  AlertCircle,
  Users,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import Papa from "papaparse";
import type { ParseResult } from "papaparse";
import * as XLSX from "xlsx";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

type TallyMap = Record<string, number>;
type DateTallyMap = Record<string, TallyMap>;
type Row = (string | number | null | undefined)[];

type StudentEntry = {
  studentNumber: string;
  studentName: string;
  date: string;
  time: string;
  timestamp: Date;
};

type StudentRanking = {
  studentNumber: string;
  studentName: string;
  daysEntered: number;
};

type MonthlyData = {
  month: string; // YYYY-MM
  programs: TallyMap;
  timeslots: TallyMap;
  totalStudents: number;
};

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const FIND_DAY_SCAN_ROWS = 12;

const HOUR_TO_SLOT: Record<number, string> = {
  6: "6:00-7:00", 7: "7:00-8:00", 8: "8:00-9:00", 9: "9:00-10:00",
  10: "10:00-11:00", 11: "11:00-12:00", 12: "12:00-13:00", 13: "13:00-14:00",
  14: "14:00-15:00", 15: "15:00-16:00", 16: "16:00-17:00", 17: "17:00-18:00",
  18: "18:00-19:00", 19: "19:00-20:00", 20: "20:00-21:00",
};

const PROGRAM_ALIASES: Record<string, string> = {
  MKT: "MARKETING",
  MSE: "MEMSE",
};

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

const slotDisplayLabel = (slot: string) => slot;
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
    const day = a <= 12 ? b : a;
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

const parseTime = (timeStr: unknown): string | null => {
  if (!timeStr) return null;
  const s = String(timeStr).trim();
  return s;
};

const parseDateTime = (dateStr: unknown, timeStr: unknown): Date | null => {
  const isoDate = toISODate(dateStr);
  if (!isoDate) return null;
  const time = parseTime(timeStr);
  if (!time) return new Date(isoDate);
  
  // Try to parse time
  const timeMatch = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (timeMatch) {
    let hours = +timeMatch[1];
    const minutes = +timeMatch[2];
    const ampm = timeMatch[4];
    
    if (ampm) {
      if (ampm.toUpperCase() === 'PM' && hours !== 12) hours += 12;
      if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
    }
    
    return new Date(`${isoDate}T${pad(hours)}:${pad(minutes)}:00`);
  }
  
  return new Date(isoDate);
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
  const totalCol = header.findIndex((c) => String(c).trim().toLowerCase() === "total");
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
  const timeHeaderIdx = sheet.findIndex((row) => String(row[0] || "").trim().toUpperCase() === "TIME");
  if (timeHeaderIdx === -1) return;
  const header = sheet[timeHeaderIdx] || [];
  const totalCol = header.findIndex((c) => String(c).trim().toLowerCase() === "total");
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
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(new Error("FileReader error"));
    r.readAsArrayBuffer(file);
  });

const parseFileToRows = async (file: File, skipEmpty = true): Promise<Row[]> => {
  const isCsv = /\.csv$/i.test(file.name);
  const isXlsx = /\.xlsx?$/i.test(file.name);
  if (isCsv) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: false,
        skipEmptyLines: skipEmpty,
        complete: (results: ParseResult<Row>) => resolve(results.data),
        error: (err: Error) => reject(err),
      });
    });
  }
  if (isXlsx) {
    const buf = await readAsArrayBuffer(file);
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheetName = wb.SheetNames.includes("Report") ? "Report" : wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      blankrows: !skipEmpty,
      raw: false,
      dateNF: "yyyy-mm-dd hh:mm:ss",
    }) as Row[];
    return rows;
  }
  throw new Error("Unsupported file type — please upload .csv or .xlsx");
};

const downloadCSV = (sheet: Row[], filename: string): void => {
  const csv = Papa.unparse(sheet);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", filename);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Enhanced Calendar Component with Available Dates
function DatePicker({ value, onChange, availableDates = [] }: { value: string; onChange: (date: string) => void; availableDates?: string[] }) {
  const [showCalendar, setShowCalendar] = useState(false);
  
  // Start from first available date or current date
  const initialDate = availableDates.length > 0 
    ? new Date(availableDates[0])
    : new Date();
  
  const [currentMonth, setCurrentMonth] = useState(initialDate);

  const getDaysInMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const getFirstDayOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1).getDay();

  const isDateAvailable = (year: number, month: number, day: number) => {
    const dateStr = `${year}-${pad(month)}-${pad(day)}`;
    return availableDates.includes(dateStr);
  };

  const handleDateClick = (day: number) => {
    const selected = `${currentMonth.getFullYear()}-${pad(currentMonth.getMonth() + 1)}-${pad(day)}`;
    onChange(selected);
    setShowCalendar(false);
  };

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
  };

  const daysInMonth = getDaysInMonth(currentMonth);
  const firstDay = getFirstDayOfMonth(currentMonth);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const emptyDays = Array.from({ length: firstDay }, (_, i) => i);

  return (
    <div className="relative">
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          readOnly
          className="flex-1 p-2 rounded-lg bg-black/40 border border-white/10 text-white text-sm cursor-pointer hover:border-white/30 transition"
          placeholder="Select date"
        />
        <button
          onClick={() => setShowCalendar(!showCalendar)}
          className="px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-white hover:border-white/30 hover:bg-black/60 transition flex items-center justify-center"
        >
          <Calendar size={16} />
        </button>
      </div>
      {showCalendar && (
        <div className="absolute top-full left-0 mt-2 bg-gray-800 rounded-lg p-4 border border-white/20 z-50 w-72 shadow-xl">
          <div className="flex justify-between items-center mb-4">
            <button onClick={prevMonth} className="text-gray-400 hover:text-white p-1"><ChevronLeft size={18} /></button>
            <span className="text-white font-semibold text-sm">{currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}</span>
            <button onClick={nextMonth} className="text-gray-400 hover:text-white p-1"><ChevronRight size={18} /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
              <div key={d} className="text-center text-xs text-gray-500 font-semibold py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {emptyDays.map((i) => <div key={`empty-${i}`} className="aspect-square" />)}
            {days.map((day) => {
              const isSelected = value === `${currentMonth.getFullYear()}-${pad(currentMonth.getMonth() + 1)}-${pad(day)}`;
              const available = isDateAvailable(currentMonth.getFullYear(), currentMonth.getMonth() + 1, day);
              return (
                <button
                  key={day}
                  onClick={() => handleDateClick(day)}
                  disabled={!available}
                  className={`aspect-square rounded text-xs font-semibold transition ${
                    isSelected
                      ? 'bg-red-600 text-white'
                      : available
                      ? 'bg-white/5 text-gray-300 hover:bg-white/10 cursor-pointer'
                      : 'bg-gray-700/30 text-gray-600 cursor-not-allowed'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
          {availableDates.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/10 text-xs text-gray-400">
              Available dates: {availableDates[0]} to {availableDates[availableDates.length - 1]}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════

export default function App() {
  // Existing state
  const [masterRows, setMasterRows] = useState<Row[]>([]);
  const [logFileName, setLogFileName] = useState<string>("");
  const [masterFileName, setMasterFileName] = useState<string>("");
  const [talliesByDate, setTalliesByDate] = useState<DateTallyMap>({});
  const [timeTalliesByDate, setTimeTalliesByDate] = useState<DateTallyMap>({});
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: "", end: "" });

  // Student entries for advanced features
  const [studentEntries, setStudentEntries] = useState<StudentEntry[]>([]);
  
  // Monthly analytics state
  const [viewMode, setViewMode] = useState<"daily" | "monthly">("daily");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  
  // Student ranking state
  const [showRanking, setShowRanking] = useState(false);
  const [rankingPeriod, setRankingPeriod] = useState<"month" | "semester" | "year">("month");
  const [rankingTopN, setRankingTopN] = useState<number>(10);
  const [rankings, setRankings] = useState<StudentRanking[]>([]);
  
  // Export error window toggle
  const [exportErrorWindow, setExportErrorWindow] = useState(false);
  
  // Hourly analytics state
  const [showHourly, setShowHourly] = useState(false);
  const [selectedHour, setSelectedHour] = useState<number>(7);
  const [hourlyStudents, setHourlyStudents] = useState<StudentEntry[]>([]);

  // Handle log upload with student entry tracking
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

    const hdr = rawData[headerIdx];
    const progIdx = hdr.findIndex((c) => String(c).toLowerCase().includes("program"));
    const dateIdx = hdr.findIndex((c) => String(c).toLowerCase().includes("date"));
    const timeIdx = hdr.findIndex((c) => String(c).toLowerCase().includes("time"));
    const studentNumIdx = hdr.findIndex((c) => 
      String(c).toLowerCase().includes("student") && 
      (String(c).toLowerCase().includes("number") || String(c).toLowerCase().includes("no"))
    );
    const nameIdx = hdr.findIndex((c) => String(c).toLowerCase().includes("name"));

    const countsByDate: DateTallyMap = {};
    const timeCountsByDate: DateTallyMap = {};
    const seen = new Set<string>();
    const entries: StudentEntry[] = [];

    rawData.slice(headerIdx + 1).forEach((row) => {
      const iso = toISODate(row?.[dateIdx]);
      const prog = normalizeProgram(row?.[progIdx]);
      if (!iso || !prog || prog === "PROGRAM") return;

      // Store student entry if we have student number
      if (studentNumIdx !== -1 && row?.[studentNumIdx]) {
        const timestamp = parseDateTime(row?.[dateIdx], row?.[timeIdx]);
        if (timestamp) {
          entries.push({
            studentNumber: String(row[studentNumIdx]).trim(),
            studentName: nameIdx !== -1 ? String(row[nameIdx] || "").trim() : "",
            date: iso,
            time: parseTime(row?.[timeIdx]) || "",
            timestamp,
          });
        }
      }

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
    setStudentEntries(entries);

    // Compute monthly data
    computeMonthlyData(countsByDate, timeCountsByDate);

    const first = sorted[0] || "";
    setSelectedDay(first);
  };

  // Compute monthly analytics
  const computeMonthlyData = (
    countsByDate: DateTallyMap,
    timeCountsByDate: DateTallyMap
  ) => {
    const monthMap: Record<string, MonthlyData> = {};

    Object.keys(countsByDate).forEach((date) => {
      const month = date.slice(0, 7);
      if (!monthMap[month]) {
        monthMap[month] = {
          month,
          programs: {},
          timeslots: {},
          totalStudents: 0,
        };
      }

      Object.entries(countsByDate[date]).forEach(([prog, count]) => {
        monthMap[month].programs[prog] = (monthMap[month].programs[prog] || 0) + count;
        monthMap[month].totalStudents += count;
      });

      if (timeCountsByDate[date]) {
        Object.entries(timeCountsByDate[date]).forEach(([slot, count]) => {
          monthMap[month].timeslots[slot] = (monthMap[month].timeslots[slot] || 0) + count;
        });
      }
    });

    const sorted = Object.values(monthMap).sort((a, b) => b.month.localeCompare(a.month));
    setMonthlyData(sorted);
    if (sorted.length > 0) setSelectedMonth(sorted[0].month);
  };

  // Compute student rankings
  const computeRankings = () => {
    if (studentEntries.length === 0) {
      alert("No student data available. Please upload a log file with student information.");
      return;
    }

    let dateFilter: (date: string) => boolean;
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    if (rankingPeriod === "month") {
      dateFilter = (date) => {
        const [year, month] = date.split('-').map(Number);
        return year === currentYear && month === currentMonth;
      };
    } else if (rankingPeriod === "semester") {
      const fourMonthsAgo = new Date(now);
      fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4);
      const cutoff = toISODate(fourMonthsAgo);
      dateFilter = (date) => cutoff ? date >= cutoff : true;
    } else {
      const oneYearAgo = new Date(now);
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      const cutoff = toISODate(oneYearAgo);
      dateFilter = (date) => cutoff ? date >= cutoff : true;
    }

    const filteredEntries = studentEntries.filter((e) => dateFilter(e.date));

    let entriesToUse = filteredEntries;
    if (filteredEntries.length === 0 && rankingPeriod === "month") {
      const latestMonth = monthlyData.length > 0 ? monthlyData[0].month : null;
      if (latestMonth) {
        entriesToUse = studentEntries.filter((e) => e.date.startsWith(latestMonth));
      }
    }

    const studentDays: Record<string, Set<string>> = {};
    const studentNames: Record<string, string> = {};

    entriesToUse.forEach((entry) => {
      if (!studentDays[entry.studentNumber]) {
        studentDays[entry.studentNumber] = new Set();
        studentNames[entry.studentNumber] = entry.studentName;
      }
      studentDays[entry.studentNumber].add(entry.date);
    });

    const ranked: StudentRanking[] = Object.keys(studentDays).map((studentNumber) => ({
      studentNumber,
      studentName: studentNames[studentNumber] || "Unknown",
      daysEntered: studentDays[studentNumber].size,
    }));

    ranked.sort((a, b) => b.daysEntered - a.daysEntered);

    if (ranked.length === 0) {
      alert("No students found for the selected period.");
      return;
    }

    setRankings(ranked.slice(0, rankingTopN));
    setShowRanking(true);
  };

  // Get students for selected hour on selected day
  const getHourlyStudents = () => {
    if (studentEntries.length === 0) {
      alert("No student data available.");
      return;
    }

    const filtered = studentEntries.filter((entry) => {
      const hour = entry.timestamp.getHours();
      return hour === selectedHour && entry.date === selectedDay;
    });

    filtered.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    setHourlyStudents(filtered);
    setShowHourly(true);
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

  const buildFilledSheet = (days: string[], applyErrorWindow: boolean): { newSheet: Row[]; missing: number[] } => {
    const newSheet: Row[] = masterRows.map((row) => [...row]);
    const missing: number[] = [];

    let workingTallies = talliesByDate;
    let workingTimeTallies = timeTalliesByDate;

    // CORRECTED: Apply error window by counting ONLY filtered entries
    if (applyErrorWindow && studentEntries.length > 0) {
      // Step 1: Filter entries to only include one per student per day (30-min window)
      const filtered: StudentEntry[] = [];
      const lastEntry: Record<string, Date> = {};

      const sortedEntries = [...studentEntries].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      sortedEntries.forEach((entry) => {
        const key = `${entry.studentNumber}-${entry.date}`;
        const last = lastEntry[key];

        if (!last || (entry.timestamp.getTime() - last.getTime()) >= 30 * 60 * 1000) {
          filtered.push(entry);
          lastEntry[key] = entry.timestamp;
        }
      });

      // Step 2: Build time tallies FIRST by directly counting filtered entries
      const newTimeTallies: DateTallyMap = {};
      filtered.forEach((entry) => {
        const iso = entry.date;
        const hour = entry.timestamp.getHours();
        const slotKey = hourToSlotKey(hour);

        if (slotKey) {
          if (!newTimeTallies[iso]) newTimeTallies[iso] = {};
          newTimeTallies[iso][slotKey] = (newTimeTallies[iso][slotKey] || 0) + 1;
        }
      });

      // Step 3: Build program tallies by distributing filtered entries proportionally
      const newTallies: DateTallyMap = {};
      filtered.forEach((entry) => {
        const iso = entry.date;
        
        if (talliesByDate[iso]) {
          const dayTotal = Object.values(talliesByDate[iso]).reduce((a, b) => a + b, 0);
          Object.keys(talliesByDate[iso]).forEach((prog) => {
            if (!newTallies[iso]) newTallies[iso] = {};
            const proportion = talliesByDate[iso][prog] / dayTotal;
            newTallies[iso][prog] = (newTallies[iso][prog] || 0) + proportion;
          });
        }
      });

      // Step 4: Round and normalize programs to match time totals exactly
      Object.keys(newTallies).forEach((date) => {
        // Round all program values
        Object.keys(newTallies[date]).forEach((prog) => {
          newTallies[date][prog] = Math.round(newTallies[date][prog]);
        });
        
        // Force program total to equal time total
        const dayProgramTotal = Object.values(newTallies[date]).reduce((a, b) => a + b, 0);
        const dayTimeTotal = Object.values(newTimeTallies[date] || {}).reduce((a, b) => a + b, 0);
        
        if (dayProgramTotal !== dayTimeTotal && dayProgramTotal > 0) {
          // Adjust the largest program to absorb the difference
          const difference = dayTimeTotal - dayProgramTotal;
          const largestProgEntry = Object.entries(newTallies[date]).reduce((a, b) => (b[1] > a[1] ? b : a));
          if (largestProgEntry) {
            newTallies[date][largestProgEntry[0]] += difference;
          }
        }
      });

      // Round time values
      Object.keys(newTimeTallies).forEach((date) => {
        Object.keys(newTimeTallies[date]).forEach((slot) => {
          newTimeTallies[date][slot] = Math.round(newTimeTallies[date][slot]);
        });
      });

      workingTallies = newTallies;
      workingTimeTallies = newTimeTallies;
    }

    days.forEach((iso) => {
      const dayValue = dayFromISO(iso);
      const dateColIndex = findDayColumnIndex(newSheet, dayValue);
      if (dateColIndex === -1) {
        missing.push(dayValue);
        return;
      }
      const progMap: TallyMap = workingTallies[iso] || {};
      const timeMap: TallyMap = workingTimeTallies[iso] || {};
      newSheet.forEach((row, rowIndex) => {
        const rawLabel = String(row[0] || "").trim();
        const labelUp = rawLabel.toUpperCase();
        if (!rawLabel || labelUp === "PROGRAM" || labelUp === "SUMMARY" || labelUp === "TIME" || labelUp === "TOTAL") return;
        
        // Check if this is a time slot
        let matchedSlotKey: string | null = null;
        for (const slotKey of Object.values(HOUR_TO_SLOT)) {
          if (slotKey === rawLabel) {
            matchedSlotKey = slotKey;
            break;
          }
        }
        
        if (matchedSlotKey) {
          const count = timeMap[matchedSlotKey] ?? 0;
          if (count) newSheet[rowIndex][dateColIndex] = count;
          return;
        }
        
        // Otherwise treat as a program
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
    if (masterRows.length === 0 || !selectedDay) return alert("Upload both files first and select a day.");
    const { newSheet, missing } = buildFilledSheet([selectedDay], exportErrorWindow);
    if (missing.length) alert(`Day column not found in Master for day(s): ${missing.join(", ")}`);
    downloadCSV(newSheet, `Library_Mapua_Report_${dayFromISO(selectedDay)}.csv`);
  };

  const processAndDownloadRange = () => {
    if (masterRows.length === 0) return alert("Upload the Master Template first.");
    if (!dateRange.start || !dateRange.end) return alert("Pick a start and end date.");
    if (Object.keys(talliesByDate).length === 0) return alert("Upload the daily log first.");
    const days = datesBetween(dateRange.start, dateRange.end);
    if (!days.length) return alert("Date range is invalid or empty.");
    const { newSheet, missing } = buildFilledSheet(days, exportErrorWindow);
    if (missing.length) alert(`Day columns not found in Master for: ${missing.join(", ")}.`);
    downloadCSV(newSheet, `Library_Mapua_Report_${dateRange.start}_to_${dateRange.end}.csv`);
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
    const filtered = masterRows.map((row) => row.filter((_: unknown, c: number) => colsToKeep.has(c)));
    downloadCSV(filtered, `Master_RangeOnly_${dateRange.start}_to_${dateRange.end}.csv`);
  };

  const currentMonthData = viewMode === "monthly" && selectedMonth
    ? monthlyData.find((m) => m.month === selectedMonth)
    : null;

  const currentDayData = viewMode === "daily" && selectedDay ? {
    date: selectedDay,
    programs: talliesByDate[selectedDay] || {},
    timeslots: timeTalliesByDate[selectedDay] || {},
  } : null;

  return (
    <div className="min-h-screen relative bg-gradient-to-br from-gray-950 to-gray-900">
      {/* Background */}
      <div className="fixed inset-0" style={{ backgroundImage: "url('/mapua-campus-bg.jpg')", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.1 }} />
      
      <div className="relative z-10 max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <header className="mb-10 pb-6 border-b border-red-900/30">
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-red-600 to-red-700 border border-red-500/50 flex items-center justify-center shadow-lg">
                  <GraduationCap size={22} className="text-white" />
                </div>
                <div>
                  <span className="text-xs tracking-widest uppercase text-red-400 font-bold">Mapua University Library</span>
                </div>
              </div>
              <h1 className="text-6xl font-black text-white leading-tight tracking-tight">
                Library <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-red-400 to-red-500">Analytics</span>
              </h1>
              <p className="text-sm text-gray-400 mt-2 font-light tracking-wide">Student Attendance & Engagement System</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-600/10 to-red-700/10 border border-red-500/20 backdrop-blur">
                <Heart size={13} fill="#ef4444" className="text-red-500" />
                <span className="text-xs text-gray-300 font-medium">Developed by: Acpal, Argueza, Francisco III, Aquino, Lauguico</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600/10 to-blue-700/10 border border-blue-500/20 backdrop-blur">
                <span className="text-xs text-blue-300 font-medium">Adviser: <span className="text-blue-200">Mylyn Bautista</span></span>
              </div>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Sidebar */}
          <div className="lg:col-span-4 space-y-5">
            {/* File Inputs */}
            <div className="rounded-2xl p-6 bg-gray-900/80 border border-white/10 backdrop-blur">
              <h2 className="text-sm font-bold mb-5 text-white flex items-center gap-2 uppercase tracking-wider">
                <FileSpreadsheet size={16} className="text-amber-400" />
                Input Files
              </h2>
              <div className="space-y-4">
                <label className="block cursor-pointer group">
                  <span className="text-xs uppercase tracking-wider text-red-500 font-semibold">Daily Log (.csv or .xlsx)</span>
                  <div className="mt-2 p-4 rounded-xl flex items-center gap-3 bg-black/40 border border-white/5 group-hover:border-red-600/50 transition">
                    <Database size={18} className="text-red-500" />
                    <span className="text-xs text-gray-400 flex-1 truncate">{logFileName || "Click to upload…"}</span>
                    {availableDates.length > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">{availableDates.length}d</span>}
                  </div>
                  <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleLogUpload} />
                </label>
                
                <label className="block cursor-pointer group">
                  <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold">Master Template (.csv or .xlsx)</span>
                  <div className="mt-2 p-4 rounded-xl flex items-center gap-3 bg-black/40 border border-white/5 group-hover:border-yellow-600/50 transition">
                    <FileSpreadsheet size={18} className="text-yellow-500" />
                    <span className="text-xs text-gray-400 flex-1 truncate">{masterFileName || "Click to upload…"}</span>
                    {masterRows.length > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">{masterRows.length}r</span>}
                  </div>
                  <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleMasterUpload} />
                </label>
              </div>
            </div>

            {/* View Mode Toggle */}
            {availableDates.length > 0 && (
              <div className="rounded-2xl p-6 bg-gray-900/80 border border-white/10 backdrop-blur">
                <h2 className="text-sm font-bold mb-4 text-white flex items-center gap-2 uppercase tracking-wider">
                  <Calendar size={16} className="text-amber-400" />
                  Analytics View
                </h2>
                <div className="flex gap-2 mb-4">
                  <button
                    onClick={() => setViewMode("daily")}
                    className={`flex-1 py-2 px-4 rounded-lg text-xs font-semibold uppercase tracking-wide transition ${
                      viewMode === "daily"
                        ? "bg-red-600 text-white"
                        : "bg-white/5 text-gray-400 hover:bg-white/10"
                    }`}
                  >
                    Daily
                  </button>
                  <button
                    onClick={() => setViewMode("monthly")}
                    className={`flex-1 py-2 px-4 rounded-lg text-xs font-semibold uppercase tracking-wide transition ${
                      viewMode === "monthly"
                        ? "bg-red-600 text-white"
                        : "bg-white/5 text-gray-400 hover:bg-white/10"
                    }`}
                  >
                    Monthly
                  </button>
                </div>

                {viewMode === "daily" && (
                  <div>
                    <label className="text-xs text-gray-400 mb-2 block">Select Day</label>
                    <select
                      value={selectedDay}
                      onChange={(e) => setSelectedDay(e.target.value)}
                      className="w-full p-2 rounded-lg bg-black/40 border border-white/10 text-white text-sm"
                    >
                      {availableDates.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {viewMode === "monthly" && monthlyData.length > 0 && (
                  <div>
                    <label className="text-xs text-gray-400 mb-2 block">Select Month</label>
                    <select
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(e.target.value)}
                      className="w-full p-2 rounded-lg bg-black/40 border border-white/10 text-white text-sm"
                    >
                      {monthlyData.map((m) => (
                        <option key={m.month} value={m.month}>
                          {m.month}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Student Ranking Controls */}
            {studentEntries.length > 0 && (
              <div className="rounded-2xl p-6 bg-gray-900/80 border border-white/10 backdrop-blur">
                <h2 className="text-sm font-bold mb-4 text-white flex items-center gap-2 uppercase tracking-wider">
                  <Trophy size={16} className="text-amber-400" />
                  Top Visitors
                </h2>
                
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Period</label>
                    <select
                      value={rankingPeriod}
                      onChange={(e) => setRankingPeriod(e.target.value as "month" | "semester" | "year")}
                      className="w-full p-2 rounded-lg bg-black/40 border border-white/10 text-white text-sm"
                    >
                      <option value="month">This Month</option>
                      <option value="semester">This Semester (4 months)</option>
                      <option value="year">This Year</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Top N Students</label>
                    <select
                      value={rankingTopN}
                      onChange={(e) => setRankingTopN(+e.target.value)}
                      className="w-full p-2 rounded-lg bg-black/40 border border-white/10 text-white text-sm"
                    >
                      <option value="5">Top 5</option>
                      <option value="10">Top 10</option>
                      <option value="20">Top 20</option>
                      <option value="50">Top 50</option>
                    </select>
                  </div>

                  <button
                    onClick={computeRankings}
                    className="w-full py-2 px-4 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold uppercase tracking-wide transition"
                  >
                    View Rankings
                  </button>
                </div>
              </div>
            )}

            {/* Hourly Analytics Controls */}
            {studentEntries.length > 0 && (
              <div className="rounded-2xl p-6 bg-gray-900/80 border border-white/10 backdrop-blur">
                <h2 className="text-sm font-bold mb-4 text-white flex items-center gap-2 uppercase tracking-wider">
                  <Clock size={16} className="text-purple-400" />
                  Time Analysis
                </h2>
                
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Select Day</label>
                    <select
                      value={selectedDay}
                      onChange={(e) => setSelectedDay(e.target.value)}
                      className="w-full p-2 rounded-lg bg-black/40 border border-white/10 text-white text-sm"
                    >
                      {availableDates.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Select Hour</label>
                    <select
                      value={selectedHour}
                      onChange={(e) => setSelectedHour(+e.target.value)}
                      className="w-full p-2 rounded-lg bg-black/40 border border-white/10 text-white text-sm"
                    >
                      {Object.entries(HOUR_TO_SLOT).map(([hour, label]) => (
                        <option key={hour} value={hour}>
                          {slotDisplayLabel(label)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={getHourlyStudents}
                    className="w-full py-2 px-4 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold uppercase tracking-wide transition"
                  >
                    View Students
                  </button>
                </div>
              </div>
            )}

            {/* Single Date Export */}
            {selectedDay && masterRows.length > 0 && (
              <div className="rounded-2xl p-6 bg-gray-900/80 border border-white/10 backdrop-blur">
                <h2 className="text-sm font-bold mb-4 text-white flex items-center gap-2 uppercase tracking-wider">
                  <Download size={16} className="text-green-400" />
                  Export Single Date
                </h2>
                
                <div className="flex items-center gap-2 mb-3 pb-3 border-b border-white/10">
                  <input
                    type="checkbox"
                    id="exportErrorWindow"
                    checked={exportErrorWindow}
                    onChange={(e) => setExportErrorWindow(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <label htmlFor="exportErrorWindow" className="text-xs text-gray-300 flex items-center gap-1">
                    <AlertCircle size={12} />
                    Apply 30-min error window
                  </label>
                </div>

                <button
                  onClick={processAndDownload}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-green-600 to-green-700 text-white text-xs font-bold uppercase tracking-wide hover:shadow-lg transition"
                >
                  <Download size={13} className="inline mr-2" />
                  Generate Report ({selectedDay})
                </button>
              </div>
            )}

            {/* Date Range Export */}
            <div className="rounded-2xl p-6 bg-gray-900/80 border border-white/10 backdrop-blur">
              <h2 className="text-sm font-bold mb-4 text-white flex items-center gap-2 uppercase tracking-wider">
                <Calendar size={16} className="text-orange-400" />
                Export Date Range
              </h2>
              <div className="space-y-3 mb-4">
                <div>
                  <label className="text-xs text-gray-400 mb-2 block">Start Date</label>
                  <DatePicker value={dateRange.start} onChange={(d) => setDateRange(r => ({ ...r, start: d }))} availableDates={availableDates} />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-2 block">End Date</label>
                  <DatePicker value={dateRange.end} onChange={(d) => setDateRange(r => ({ ...r, end: d }))} availableDates={availableDates} />
                </div>
              </div>

              <div className="flex items-center gap-2 mb-3 pb-3 border-b border-white/10">
                <input
                  type="checkbox"
                  id="exportErrorWindowRange"
                  checked={exportErrorWindow}
                  onChange={(e) => setExportErrorWindow(e.target.checked)}
                  className="w-4 h-4"
                />
                <label htmlFor="exportErrorWindowRange" className="text-xs text-gray-300 flex items-center gap-1">
                  <AlertCircle size={12} />
                  Apply 30-min error window
                </label>
              </div>

              <div className="space-y-3">
                <button
                  onClick={processAndDownloadRange}
                  disabled={!dateRange.start || !dateRange.end || masterRows.length === 0}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-red-600 to-red-700 text-white text-xs font-bold uppercase tracking-wide disabled:opacity-30 hover:shadow-lg transition"
                >
                  <Download size={13} className="inline mr-2" />
                  Generate Report (Range)
                </button>
                <button
                  onClick={downloadMasterRangeOnly}
                  disabled={!dateRange.start || !dateRange.end || masterRows.length === 0}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-yellow-600 to-yellow-700 text-white text-xs font-bold uppercase tracking-wide disabled:opacity-30 hover:shadow-lg transition"
                >
                  <Download size={13} className="inline mr-2" />
                  Master Range Only
                </button>
              </div>
            </div>
          </div>

          {/* Right Panel - Analytics */}
          <div className="lg:col-span-8">
            <div className="rounded-2xl overflow-hidden bg-gray-900/60 border border-white/10 backdrop-blur min-h-[600px]">
              <div className="px-8 py-5 border-b border-white/5 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
                  <span className="text-sm font-bold uppercase tracking-wider text-white">
                    {viewMode === "monthly" ? "Monthly Analytics" : "Daily Analytics"}
                  </span>
                </div>
              </div>

              <div className="p-8">
                {/* Monthly Analytics Display */}
                {viewMode === "monthly" && currentMonthData ? (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-bold text-white mb-4">
                        {currentMonthData.month} Overview
                      </h3>
                      <div className="text-2xl font-bold text-amber-500 mb-6">
                        {currentMonthData.totalStudents.toLocaleString()} Total Students
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-gray-400 mb-3">Programs</h4>
                      <div className="space-y-2">
                        {Object.entries(currentMonthData.programs)
                          .sort((a, b) => b[1] - a[1])
                          .map(([prog, count]) => {
                            const pct = currentMonthData.totalStudents
                              ? Math.round((count / currentMonthData.totalStudents) * 100)
                              : 0;
                            return (
                              <div key={prog} className="flex items-center gap-3">
                                <span className="w-24 text-right text-xs text-gray-400 font-mono">{prog}</span>
                                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-gradient-to-r from-red-600 to-red-500 rounded-full"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="w-16 text-right text-sm font-bold text-white">{count}</span>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                ) : viewMode === "daily" && currentDayData && Object.keys(currentDayData.programs).length > 0 ? (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-300 mb-3">Programs ({currentDayData.date})</h3>
                      <div className="space-y-2">
                        {Object.entries(currentDayData.programs)
                          .sort((a, b) => b[1] - a[1])
                          .map(([prog, count]) => {
                            const dayTotal = Object.values(currentDayData.programs).reduce((a, b) => a + b, 0);
                            const pct = dayTotal ? Math.round((count / dayTotal) * 100) : 0;
                            return (
                              <div key={prog} className="flex items-center gap-3">
                                <span className="w-24 text-right text-xs text-gray-400 font-mono">{prog}</span>
                                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-gradient-to-r from-red-600 to-red-500 rounded-full"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="w-16 text-right text-sm font-bold text-white">{count}</span>
                              </div>
                            );
                          })}
                      </div>
                    </div>

                    {Object.keys(currentDayData.timeslots).length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-300 mb-3">Time Slots</h3>
                        <div className="space-y-2">
                          {Object.entries(currentDayData.timeslots)
                            .sort((a, b) => b[1] - a[1])
                            .map(([slot, count]) => {
                              const dayTotal = Object.values(currentDayData.timeslots).reduce((a, b) => a + b, 0);
                              return (
                                <div key={slot} className="flex items-center gap-3">
                                  <span className="w-24 text-right text-xs text-gray-400 font-mono">{slotDisplayLabel(slot)}</span>
                                  <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-gradient-to-r from-blue-600 to-blue-500 rounded-full"
                                      style={{ width: `${dayTotal ? Math.round((count / dayTotal) * 100) : 0}%` }}
                                    />
                                  </div>
                                  <span className="w-16 text-right text-sm font-bold text-white">{count}</span>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-80 flex flex-col items-center justify-center text-gray-600">
                    <Search size={48} />
                    <p className="mt-4 text-xs uppercase tracking-widest">No data — upload a log file</p>
                  </div>
                )}
              </div>
            </div>

            {/* Student Ranking Modal */}
            {showRanking && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setShowRanking(false)}>
                <div className="bg-gray-900 rounded-2xl p-8 max-w-2xl w-full max-h-[80vh] overflow-auto border border-white/20" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                      <Trophy className="text-amber-500" />
                      Top {rankingTopN} Students
                    </h2>
                    <button onClick={() => setShowRanking(false)} className="text-gray-400 hover:text-white">✕</button>
                  </div>

                  <div className="space-y-2">
                    {rankings.map((rank, idx) => (
                      <div key={rank.studentNumber} className="flex items-center gap-4 p-4 rounded-lg bg-white/5 hover:bg-white/10 transition">
                        <span className={`text-2xl font-bold ${idx < 3 ? 'text-amber-500' : 'text-gray-500'}`}>
                          #{idx + 1}
                        </span>
                        <div className="flex-1">
                          <div className="font-semibold text-white">{rank.studentName || "Unknown"}</div>
                          <div className="text-xs text-gray-400">{rank.studentNumber}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold text-amber-500">{rank.daysEntered}</div>
                          <div className="text-xs text-gray-400">days</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Hourly Students Modal */}
            {showHourly && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setShowHourly(false)}>
                <div className="bg-gray-900 rounded-2xl p-8 max-w-3xl w-full max-h-[80vh] overflow-auto border border-white/20" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                      <Users className="text-purple-500" />
                      Students at {HOUR_TO_SLOT[selectedHour]}
                    </h2>
                    <button onClick={() => setShowHourly(false)} className="text-gray-400 hover:text-white">✕</button>
                  </div>

                  {hourlyStudents.length > 0 ? (
                    <div className="space-y-2">
                      {hourlyStudents.map((entry, idx) => (
                        <div key={idx} className="flex items-center gap-4 p-4 rounded-lg bg-white/5">
                          <div className="flex-1">
                            <div className="font-semibold text-white">{entry.studentName || "Unknown"}</div>
                            <div className="text-xs text-gray-400">{entry.studentNumber}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm text-purple-400 font-mono">{entry.time}</div>
                            <div className="text-xs text-gray-500">{entry.date}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center text-gray-500 py-12">No students found for this hour</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}