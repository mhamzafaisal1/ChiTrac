import { of } from 'rxjs';
import { loadPdfTools } from './pdf-tools';
import { MachineReportComponent } from '../../reports/machine-report/machine-report.component';

describe('Deferred PDF exports', () => {
  it('shares library loading and generates a valid table PDF', async () => {
    const first = loadPdfTools();
    expect(loadPdfTools()).toBe(first);
    const { jsPDF, autoTable } = await first;
    const doc = new jsPDF();
    autoTable(doc, { head: [['Machine', 'Count']], body: [['SPL1', 123]] });
    expect(doc.output().startsWith('%PDF-')).toBeTrue();
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('waits for PDF generation before saving, and keeps the button busy until done', async () => {
    let finish!: (doc: any) => void;
    const save = jasmine.createSpy('save');
    const page: any = { startTime: 'start', endTime: 'end',
      buildMachineReportPdf: () => new Promise(resolve => finish = resolve) };
    const work = MachineReportComponent.prototype.downloadMachineItemSummaryPdf.call(page);
    expect(page.isDownloading).toBeTrue(); expect(save).not.toHaveBeenCalled();
    finish({ save }); await work;
    expect(save).toHaveBeenCalledWith('machine_report_start_end.pdf');
    expect(page.isDownloading).toBeFalse();
  });

  it('waits for PDF generation before sending the report email', async () => {
    const send = jasmine.createSpy().and.returnValue(of({}));
    const page: any = { startTime: '2026-11-02T08:00:00', endTime: '2026-11-02T09:00:00', showSummaryOnly: false,
      buildMachineReportPdf: async () => ({ output: () => 'data:application/pdf;base64,cGRm' }),
      reportsService: { emailMachineReport: send }, showMessage() {} };
    const work = (MachineReportComponent.prototype as any).emailMachineReport.call(page, 'qa@example.test');
    expect(send).not.toHaveBeenCalled(); await work;
    expect(send).toHaveBeenCalledWith(jasmine.objectContaining({ to: 'qa@example.test', pdfBase64: 'cGRm' }));
    expect(page.isEmailing).toBeFalse();
  });

  it('clears the busy state and reports an export failure after asynchronous generation fails', async () => {
    spyOn(console, 'error');
    const page: any = { startTime: 'start', endTime: 'end',
      buildMachineReportPdf: () => Promise.reject(new Error('chunk unavailable')),
      showMessage: jasmine.createSpy() };
    await MachineReportComponent.prototype.downloadMachineItemSummaryPdf.call(page);
    expect(page.isDownloading).toBeFalse();
    expect(page.showMessage).toHaveBeenCalledWith('Failed to download machine report PDF.');
  });
});
