import { pdfjs } from 'react-pdf'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
