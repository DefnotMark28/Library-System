import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { FileSpreadsheet, Download, Database, GraduationCap, Heart, Search } from 'lucide-react';
import Papa from 'papaparse';
import type { ParseResult } from 'papaparse';
import * as XLSX from 'xlsx';

interface TallyMap { [program: string]: number; }

export default function App() {
  const [tallies, setTallies] = useState<TallyMap>({});
  const [masterRows, setMasterRows] = useState<any[][]>([]);
  const [logFileName, setLogFileName] = useState<string>("");
  const [detectedDate, setDetectedDate] = useState<string>("");
  const [tallies, setTallies] = useState<TallyMap>({});
  const [masterRows, setMasterRows] = useState<any[][]>([]);
  const [logFileName, setLogFileName] = useState<string>("");
  const [detectedDate, setDetectedDate] = useState<string>("");

  const [talliesByDate, setTalliesByDate] = useState<Record<string, TallyMap>>({});
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: "", end: "" });

  const FIND_DAY_SCAN_ROWS = 10;

  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

  const toISODate = (raw: string): string | null => {
    if (!raw) return null;
    const s = String(raw).trim();
    const token = s.split(/[ T]/)[0];

  const mIso = token.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mIso) {
    const y = +mIso[1], mo = +mIso[2], d = +mIso[3];
    if (mo>=1 && mo<=12 && d>=1 && d<=31) return `${y}-${pad(mo)}-${pad(d)}`;
  }

  const mSlash = token.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mSlash) {
    let a = +mSlash[1], b = +mSlash[2], y = +mSlash[3];
    if (y < 100) y += 2000;
    const month = a <= 12 ? a : b;
    const day   = a <= 12 ? b : a;
    if (month>=1 && month<=12 && day>=1 && day<=31) return `${y}-${pad(month)}-${pad(day)}`;
  }

  const months: Record<string, number> = {
    jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,
    jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,
    oct:10,october:10,nov:11,november:11,dec:12,december:12
  };
  const mName = token.replace(",", "").match(/^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/);
  if (mName) {
    const mo = months[mName[1].toLowerCase()], d = +mName[2], y = +mName[3];
    if (mo && d>=1 && d<=31) return `${y}-${pad(mo)}-${pad(d)}`;
  }

  const dtry = new Date(token);
  if (!isNaN(dtry.getTime())) {
    const y = dtry.getFullYear(), mo = dtry.getMonth()+1, d = dtry.getDate();
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  return null;
};

const datesBetween = (startISO: string, endISO: string): string[] => {
  const out: string[] = [];
  if (!startISO || !endISO) return out;
  const s = new Date(startISO), e = new Date(endISO);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || s > e) return out;
  const cur = new Date(s);
  while (cur <= e) {
    out.push(`${cur.getFullYear()}-${pad(cur.getMonth()+1)}-${pad(cur.getDate())}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
};

const dayFromISO = (iso: string) => +iso.split("-")[2];

const findDayColumnIndex = (sheet: any[][], dayValue: number): number => {
  const rowsToScan = Math.min(sheet.length, FIND_DAY_SCAN_ROWS);
  for (let r = 0; r < rowsToScan; r++) {
    const row = sheet[r] || [];
    const idx = row.findIndex((cell: any, c: number) => {
      if (c === 0) return false; // col 0 is PROGRAM
      const num = parseFloat(String(cell).trim());
      return !isNaN(num) && num === dayValue;
    });
    if (idx !== -1) return idx;
  }
  return -1;
};

const formatRangeFileSuffix = (startISO: string, endISO: string) => `${startISO}_to_${endISO}`;

const PROGRAM_ALIASES: Record<string, string> = {
  // normalize to master spellings
  MKT: "MARKETING", // example alias
  // add more aliases here as needed
};

const normalizeProgram = (s: string) => {
  const key = String(s || "").replace(/\s+/g, "").toUpperCase();
  return PROGRAM_ALIASES[key] || String(s || "").trim().toUpperCase();
};

const recomputeRowTotals = (sheet: any[][]) => {
  const HEADER_ROW = 1;
  const header = sheet[HEADER_ROW] || [];
  const totalCol = header.findIndex((c: any) => String(c).trim().toLowerCase() === 'total');
  if (totalCol === -1) return;

  const dayCols = [];
  for (let c = 1; c < totalCol; c++) dayCols.push(c);

  for (let r = HEADER_ROW + 1; r < sheet.length; r++) {
    const label = String(sheet[r][0] || "").trim().toUpperCase();
    if (!label || label === "TOTAL" || label === "SUMMARY" || label === "TIME") continue; // skip summary block
    let sum = 0;
    dayCols.forEach(c => {
      const v = parseFloat(String(sheet[r][c] ?? "").trim());
      if (!isNaN(v)) sum += v;
    });
    sheet[r][totalCol] = sum ? sum : "";
  }
};

const getDayFromAnyDate = (s: string) => {
  const iso = toISODate(s);
  return iso ? dayFromISO(iso) : NaN;
};
  

  const handleLogUpload = (e: ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  setLogFileName(file.name);

  const isXlsx = /\.xlsx?$/i.test(file.name);
  const isCsv  = /\.csv$/i.test(file.name);

  const finalizeFromRows = (rawData: any[][]) => {
    const headerRowIndex = rawData.findIndex((row: any[]) =>
      row?.some((cell: any) => String(cell).toLowerCase().includes('program')) &&
      row?.some((cell: any) => String(cell).toLowerCase().includes('date'))
    );
    if (headerRowIndex === -1) return alert("Could not find 'Program' and 'Date' columns in the log file. Please check the header labels.");

    const headerRow = rawData[headerRowIndex];
    const progIdx = headerRow.findIndex((c: any) => String(c).toLowerCase().includes('program'));
    const dateIdx = headerRow.findIndex((c: any) => String(c).toLowerCase().includes('date'));

    const countsByDate: Record<string, TallyMap> = {};
    const seen = new Set<string>();

    const dataRows = rawData.slice(headerRowIndex + 1);
    dataRows.forEach((row: any[]) => {
      const iso = toISODate(String(row?.[dateIdx] ?? ""));
      const prog = normalizeProgram(row?.[progIdx]);

      if (!iso || !prog || prog === "PROGRAM") return;

      if (!countsByDate[iso]) countsByDate[iso] = {};
      countsByDate[iso][prog] = (countsByDate[iso][prog] || 0) + 1;
      seen.add(iso);
    });

    const sortedDates = Array.from(seen).sort();
    setAvailableDates(sortedDates);
    setTalliesByDate(countsByDate);

    const first = sortedDates[0] || "";
    setDetectedDate(first);
    setTallies(first ? countsByDate[first] || {} : {});
  };

  if (isCsv) {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (results: ParseResult<any[]>) => finalizeFromRows(results.data as any[][])
    });
    return;
  }

  if (isXlsx) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result as ArrayBuffer, { type: 'array' });
        const sheetName = wb.SheetNames.includes("Report") ? "Report" : wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as any[][];
        finalizeFromRows(rows);
      } catch (err) {
        console.error(err);
        alert("Failed to read the Excel log. Please ensure it's a valid .xlsx file.");
      }
    };
    reader.readAsArrayBuffer(file);
    return;
  }

  alert("Unsupported log file type. Please upload .csv or .xlsx");
};

 
  const handleMasterUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      Papa.parse(file, {
        header: false,
        complete: (results: ParseResult<any[]>) => setMasterRows(results.data)
      });
    }
  };

  const processAndDownload = () => {
    if (masterRows.length === 0 || !detectedDate) return alert("Upload missing files!");
    
    const newSheet = masterRows.map(row => [...row]);
    
    
    const dayValue = getDayFromAnyDate(detectedDate);
    
    
    let dateColIndex = -1;
    for (let r = 0; r < Math.min(newSheet.length, 5); r++) {
      dateColIndex = newSheet[r].findIndex(cell => parseFloat(cell) === dayValue);
      if (dateColIndex !== -1) break;
    }

    if (dateColIndex === -1) return alert(`Day ${dayValue} column not found in Master.`);

    
    newSheet.forEach((row, rowIndex) => {
      const masterProg = String(row[0] || "").trim().toUpperCase();
      if (tallies[masterProg]) {
        newSheet[rowIndex][dateColIndex] = tallies[masterProg];
      }
    });
    
const processAndDownloadRange = () => {
  if (masterRows.length === 0) return alert("Upload the Master Template first.");
  if (!dateRange.start || !dateRange.end) return alert("Pick a start and end date.");
  if (Object.keys(talliesByDate).length === 0) return alert("Upload the daily logs first.");

  const days = datesBetween(dateRange.start, dateRange.end);
  if (days.length === 0) return alert("The selected date range is invalid or empty.");

  const newSheet = masterRows.map(row => [...row]);
  const missing: number[] = [];

  days.forEach((iso) => {
    const dayValue = dayFromISO(iso);
    const dateColIndex = findDayColumnIndex(newSheet, dayValue);
    if (dateColIndex === -1) { missing.push(dayValue); return; }

    newSheet.forEach((row, rowIndex) => {
      // Program is column 0 in Master
      const masterProg = normalizeProgram(row[0]);
      const count = talliesByDate[iso]?.[masterProg] ?? 0;
      if (count) newSheet[rowIndex][dateColIndex] = count;
    });
  });

  if (missing.length > 0) {
    alert(`Could not find day columns in Master for: ${missing.join(", ")}. Check header rows or increase FIND_DAY_SCAN_ROWS.`);
  }

  recomputeRowTotals(newSheet);

  const csv = Papa.unparse(newSheet);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `Group7_Mapua_Report_${formatRangeFileSuffix(dateRange.start, dateRange.end)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const downloadMasterRangeOnly = () => {
  if (masterRows.length === 0) return alert("Upload the Master Template first.");
  if (!dateRange.start || !dateRange.end) return alert("Pick a start and end date.");

  const days = datesBetween(dateRange.start, dateRange.end);
  if (days.length === 0) return alert("The selected date range is invalid or empty.");

  const colsToKeep = new Set<number>([0]);

  days.forEach((iso) => {
    const dayValue = dayFromISO(iso);
    const idx = findDayColumnIndex(masterRows, dayValue);
    if (idx !== -1) colsToKeep.add(idx);
  });

  const filtered = masterRows.map(row => row.filter((_: any, cIdx: number) => colsToKeep.has(cIdx)));

  const csv = Papa.unparse(filtered);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `Master_RangeOnly_${formatRangeFileSuffix(dateRange.start, dateRange.end)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
``

  recomputeRowTotals(newSheet);

  const csv = Papa.unparse(newSheet);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `Group7_Mapua_Report_${formatRangeFileSuffix(dateRange.start, dateRange.end)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const downloadMasterRangeOnly = () => {
  if (masterRows.length === 0) return alert("Upload the Master Template first.");
  if (!dateRange.start || !dateRange.end) return alert("Pick a start and end date.");

  const days = datesBetween(dateRange.start, dateRange.end);
  if (days.length === 0) return alert("The selected date range is invalid or empty.");

  const colsToKeep = new Set<number>([0]);

  days.forEach((iso) => {
    const dayValue = dayFromISO(iso);
    const idx = findDayColumnIndex(masterRows, dayValue);
    if (idx !== -1) colsToKeep.add(idx);
  });

  const filtered = masterRows.map(row => row.filter((_: any, cIdx: number) => colsToKeep.has(cIdx)));

  const csv = Papa.unparse(filtered);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `Master_RangeOnly_${formatRangeFileSuffix(dateRange.start, dateRange.end)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
``
    

   
    const csv = Papa.unparse(newSheet);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Group7_Mapua_Report_${dayValue}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen p-6 md:p-12 relative z-10">
      <div className="max-w-6xl mx-auto">
        <header className="mb-12 flex flex-col md:flex-row justify-between items-end border-b-2 border-red-900 pb-8">
          <div>
            <h1 className="text-5xl font-black italic tracking-tighter text-white">
              <span className="text-red-600 drop-shadow-[0_0_10px_rgba(220,38,38,0.5)]">MAPUA</span> 
              <span className="ml-2 uppercase">Library System</span>
            </h1>
            <p className="text-yellow-500 font-bold text-xs tracking-[0.3em] mt-2 flex items-center gap-2 uppercase">
               <GraduationCap size={16} /> By Mapuans
            </p>
          </div>
          <div className="bg-black/40 p-5 rounded-3xl border border-red-900/50 min-w-[220px] backdrop-blur-md text-right">
            <p className="text-red-500 text-[10px] font-black uppercase tracking-widest flex items-center justify-end gap-2">
              <Heart size={10} fill="currentColor" /> Developed By
            </p>
            <p className="text-white font-black text-xl uppercase tracking-tight">Group 7</p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-slate-900/80 p-8 rounded-[2.5rem] border-2 border-red-900/20 backdrop-blur-xl shadow-2xl">
              <h2 className="text-yellow-500 text-[11px] font-black uppercase tracking-[0.4em] mb-10 border-b border-red-900/30 pb-4">Operations</h2>
              <div className="space-y-6">
                <label className="block group cursor-pointer">
                  <span className="text-red-500 text-[10px] font-black uppercase tracking-widest ml-1">Daily Log Input</span>
                  <div className="mt-2 bg-black border-2 border-slate-800 p-5 rounded-2xl group-hover:border-red-600 transition-all flex items-center gap-4">
                    <Database size={20} className="text-red-600" />
                    <span className="text-sm font-bold truncate text-slate-400 italic">{logFileName || "Upload Logs..."}</span>
                  </div>
                  <input type="file" accept=".csv,.xlsx" className="hidden" onChange={handleLogUpload} />
                </label>
                <label className="block group cursor-pointer">
                  <span className="text-slate-500 text-[10px] font-black uppercase tracking-widest ml-1">Master Template</span>
                  <div className="mt-2 bg-black border-2 border-slate-800 p-5 rounded-2xl group-hover:border-yellow-500 transition-all flex items-center gap-4">
                    <FileSpreadsheet size={20} className="text-yellow-500" />
                    <span className="text-sm font-bold text-slate-400 italic">{masterRows.length > 0 ? "Ready" : "Upload Template..."}</span>
                  </div>
                  <input type="file" accept=".csv,.xlsx" className="hidden" onChange={handleMasterUpload} />
                </label>
<div className="mt-2 bg-black border-2 border-slate-800 p-5 rounded-2xl">
  <div className="flex items-center justify-between mb-3">
    <span className="text-slate-500 text-[10px] font-black uppercase tracking-widest ml-1">Date Range</span>
    {availableDates.length > 0 && (
      <span className="text-[10px] text-slate-400 italic">
        {availableDates[0]} → {availableDates[availableDates.length - 1]}
      </span>
    )}
  </div>

  <div className="grid grid-cols-2 gap-3">
    <label className="block">
      <span className="text-slate-500 text-[10px] font-bold uppercase">Start</span>
      <input
        type="date"
        className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200"
        value={dateRange.start}
        min={availableDates[0] || undefined}
        max={availableDates[availableDates.length - 1] || undefined}
        onChange={(e) => setDateRange(r => ({ ...r, start: e.target.value }))}
      />
    </label>
    <label className="block">
      <span className="text-slate-500 text-[10px] font-bold uppercase">End</span>
      <input
        type="date"
        className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200"
        value={dateRange.end}
        min={dateRange.start || availableDates[0] || undefined}
        max={availableDates[availableDates.length - 1] || undefined}
        onChange={(e) => setDateRange(r => ({ ...r, end: e.target.value }))}
      />
    </label>
  </div>
  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
    <button
      onClick={processAndDownloadRange}
      disabled={!dateRange.start || !dateRange.end || masterRows.length === 0 || Object.keys(talliesByDate).length === 0}
      className="w-full bg-yellow-500 disabled:bg-yellow-500/40 hover:bg-yellow-400 text-black font-black py-3 rounded-xl transition-all uppercase tracking-widest"
    >
      Generate Report (Range)
    </button>
    <button
      onClick={downloadMasterRangeOnly}
      disabled={!dateRange.start || !dateRange.end || masterRows.length === 0}
      className="w-full bg-slate-200 disabled:bg-slate-700/30 text-black font-black py-3 rounded-xl transition-all uppercase tracking-widest"
    >
      Master (Range Only)
    </button>
  </div>
</div>
                {detectedDate && masterRows.length > 0 && (
                  <button onClick={processAndDownload} className="w-full mt-6 bg-yellow-500 hover:bg-yellow-400 text-black font-black py-5 rounded-2xl shadow-2xl transition-all transform hover:-translate-y-1 flex items-center justify-center gap-3 uppercase tracking-widest">
                    <Download size={20} /> Generate Report
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-8">
            <div className="bg-black/80 rounded-[3rem] border-2 border-slate-900 shadow-2xl min-h-[500px] flex flex-col backdrop-blur-sm overflow-hidden">
              <div className="p-8 border-b-2 border-slate-900 flex justify-between items-center">
                <h3 className="text-white font-black text-xl tracking-tighter uppercase italic flex items-center gap-3">
                  <span className="w-3 h-3 bg-red-600 rounded-full animate-pulse shadow-[0_0_10px_rgba(220,38,38,1)]" /> Analytics
                </h3>
                {detectedDate && <div className="text-yellow-500 font-black text-xs bg-yellow-500/10 px-4 py-2 rounded-xl border border-yellow-500/20 tracking-widest italic">{detectedDate}</div>}
              </div>
              <div className="p-10 flex-1 overflow-y-auto">
                {Object.keys(tallies).length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Object.entries(tallies).map(([prog, count]) => (
                      <div key={prog} className="flex justify-between items-center bg-white/5 p-6 rounded-2xl border border-white/5 group hover:border-red-600/50 transition-all">
                        <span className="font-black text-slate-500 uppercase tracking-widest text-[10px] group-hover:text-red-500">{prog}</span>
                        <span className="text-2xl font-black text-white group-hover:text-yellow-500">{count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center opacity-20"><Search size={64} className="text-white" /><p className="font-black tracking-[0.5em] uppercase text-[10px] mt-4 text-white">No Data Detected</p></div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
