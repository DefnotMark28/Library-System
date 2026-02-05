import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { FileSpreadsheet, Download, Database, GraduationCap, Heart, Search } from 'lucide-react';
import Papa from 'papaparse';
import type { ParseResult } from 'papaparse';

interface TallyMap { [program: string]: number; }

export default function App() {
  const [tallies, setTallies] = useState<TallyMap>({});
  const [masterRows, setMasterRows] = useState<any[][]>([]);
  const [logFileName, setLogFileName] = useState<string>("");
  const [detectedDate, setDetectedDate] = useState<string>("");

  const handleLogUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogFileName(file.name);
      Papa.parse(file, {
        header: false,
        skipEmptyLines: true,
        complete: (results: ParseResult<any[]>) => {
          const rawData = results.data;
          
          // 1. DYNAMIC HEADER DETECTION
          // We search the first 15 rows to find which row is the header
          let headerRowIndex = rawData.findIndex(row => 
            row.some((cell: any) => String(cell).toLowerCase().includes('program'))
          );

          if (headerRowIndex === -1) return alert("Could not find 'Program' column in this file!");

          const headerRow = rawData[headerRowIndex];
          const progIdx = headerRow.findIndex((c: any) => String(c).toLowerCase().includes('program'));
          const dateIdx = headerRow.findIndex((c: any) => String(c).toLowerCase().includes('date'));

          // 2. DATA EXTRACTION
          const counts: TallyMap = {};
          let logDate = "";
          const dataRows = rawData.slice(headerRowIndex + 1);

          dataRows.forEach(row => {
            const dateStr = row[dateIdx];
            if (dateStr && !logDate) logDate = String(dateStr).split(' ')[0];
            
            const prog = String(row[progIdx] || "").trim().toUpperCase();
            if (prog && prog !== "PROGRAM") {
              counts[prog] = (counts[prog] || 0) + 1;
            }
          });

          setTallies(counts);
          setDetectedDate(logDate);
        }
      });
    }
  };

  // ... (handleMasterUpload remains similar, but we'll apply the same logic)
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
    
    // Extract Day (Supports both MM/DD/YYYY and DD/MM/YYYY)
    const dayValue = parseInt(detectedDate.includes('/') ? detectedDate.split('/')[0] : detectedDate.split('-')[0]);
    
    // DYNAMIC COLUMN SEARCH in Master
    let dateColIndex = -1;
    for (let r = 0; r < Math.min(newSheet.length, 5); r++) {
      dateColIndex = newSheet[r].findIndex(cell => parseFloat(cell) === dayValue);
      if (dateColIndex !== -1) break;
    }

    if (dateColIndex === -1) return alert(`Day ${dayValue} column not found in Master.`);

    // DYNAMIC ROW SEARCH for Programs
    newSheet.forEach((row, rowIndex) => {
      const masterProg = String(row[0] || "").trim().toUpperCase();
      if (tallies[masterProg]) {
        newSheet[rowIndex][dateColIndex] = tallies[masterProg];
      }
    });

    // Generate & Download
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
                  <input type="file" accept=".csv" className="hidden" onChange={handleLogUpload} />
                </label>
                <label className="block group cursor-pointer">
                  <span className="text-slate-500 text-[10px] font-black uppercase tracking-widest ml-1">Master Template</span>
                  <div className="mt-2 bg-black border-2 border-slate-800 p-5 rounded-2xl group-hover:border-yellow-500 transition-all flex items-center gap-4">
                    <FileSpreadsheet size={20} className="text-yellow-500" />
                    <span className="text-sm font-bold text-slate-400 italic">{masterRows.length > 0 ? "Ready" : "Upload Template..."}</span>
                  </div>
                  <input type="file" accept=".csv" className="hidden" onChange={handleMasterUpload} />
                </label>
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