export const createCSVContent = (columns: string[], rows: Array<Array<string | number>>) => {
  const header = columns.join(",");
  const body = rows
    .map((row) =>
      row
        .map((value) => {
          if (value === null || value === undefined) return "";
          const str = String(value);
          return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
        })
        .join(",")
    )
    .join("\n");
  return rows.length ? `${header}\n${body}` : `${header}\n`;
};

export const downloadCSV = (
  filename: string,
  columns: string[],
  rows: Array<Array<string | number>>
) => {
  const csv = createCSVContent(columns, rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const downloadJSON = (filename: string, data: unknown) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const downloadImage = (filename: string, dataUrl: string) => {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
