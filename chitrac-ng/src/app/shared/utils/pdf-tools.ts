type PdfTools = {
  jsPDF: typeof import('jspdf').jsPDF;
  autoTable: typeof import('jspdf-autotable').default;
};

let pending: Promise<PdfTools> | undefined;

/** Load export libraries only for an actual export, and share concurrent requests. */
export function loadPdfTools(): Promise<PdfTools> {
  return pending ??= Promise.all([import('jspdf'), import('jspdf-autotable')])
    .then(([pdf, table]) => ({ jsPDF: pdf.jsPDF, autoTable: table.default }))
    .catch(error => {
      pending = undefined;
      throw error;
    });
}
