let data = [];
let dataChanged = false;
let fillColor = i => i;
let index;
let yearFillColor, languageFillColor;

const createAnnotationData = datapoint => ({
  note: {
    label: datapoint.first_author_name + " " + datapoint.year,
    bgPadding: 5,
    title: trunc(datapoint.title, 100)
  },
  x: datapoint.x,
  y: datapoint.y,
  dx: 20,
  dy: 20
});

// create a web worker that streams the chart data
const streamingLoaderWorker = new Worker("streaming-tsv-parser.js");
streamingLoaderWorker.onmessage = ({
  data: { items, totalBytes, finished }
}) => {
  const rows = items
    .map(d => ({
      ...d,
      x: Number(d.x),
      y: Number(d.y),
      year: Number(d.date)
    }))
    .filter(d => d.year);
  data = data.concat(rows);

  if (finished) {
    // compute the fill color for each datapoint
    fillColor = languageFillColor = fc
      .webglFillColor()
      .value(d => webglColor(languageColorScale(hashCode(d.language) % 10)))
      .data(data);
    yearFillColor = fc
      .webglFillColor()
      .value(d => webglColor(yearColorScale(d.year)))
      .data(data);

    // wire up the fill color selector
    iterateElements(".controls a", el => {
      el.addEventListener("click", () => {
        iterateElements(".controls a", el2 => el2.classList.remove("active"));
        el.classList.add("active");
        fillColor = el.id === "language" ? languageFillColor : yearFillColor;
        redraw();
      });
    });

    // create a spatial index for rapidly finding the closest datapoint
    index = new Flatbush(data.length);
    const p = 0.01;
    data.forEach(d => index.add(d.x - p, d.y - p, d.x + p, d.y + p));
    index.finish();
  }

  redraw();
};
streamingLoaderWorker.postMessage("data.tsv");

const languageColorScale = d3.scaleOrdinal(d3.schemeCategory10);
const yearColorScale = d3
  .scaleSequential()
  .domain([1850, 2000])
  .interpolator(d3.interpolateRdYlGn);
const xScale = d3.scaleLinear().domain([-50, 50]);
const yScale = d3.scaleLinear().domain([-50, 50]);
const xScaleOriginal = xScale.copy();
const yScaleOriginal = yScale.copy();

const line = fc
  .seriesWebglPoint()
  .equals((a, b) => a === b)
  .size(1)
  .defined(() => true)
  .crossValue(d => d.x)
  .mainValue(d => d.y)
  .decorate(program => fillColor(program));

const zoom = d3
  .zoom()
  .scaleExtent([0.8, 10])
  .on("zoom", () => {
    // update the scales based on current zoom
    xScale.domain(d3.event.transform.rescaleX(xScaleOriginal).domain());
    yScale.domain(d3.event.transform.rescaleY(yScaleOriginal).domain());
    redraw();
  });

const annotations = [];

const pointer = fc.pointer().on("point", ([coord]) => {
  annotations.pop();

  if (!coord || !index) {
    return;
  }

  // find the closes datapoint to the pointer
  const x = xScale.invert(coord.x);
  const y = yScale.invert(coord.y);
  const closestIndex = index.neighbors(x, y, 1);
  const closestDatum = data[closestIndex];

  // if the closest point is within 20 pixels, show the annotation
  if (
    distance(coord.x, coord.y, xScale(closestDatum.x), yScale(closestDatum.y)) <
    20
  ) {
    annotations[0] = createAnnotationData(closestDatum);
  }

  redraw();
});

const annotationSeries = seriesSvgAnnotation()
  .notePadding(15)
  .type(d3.annotationCallout);

const chart = fc
  .chartCartesian(xScale, yScale)
  .webglPlotArea(
    // only render the point series on the WebGL layer
    fc
      .seriesWebglMulti()
      .series([line])
      .mapping(data => data.data)
  )
  .svgPlotArea(
    // only render the annotations series on the SVG layer
    fc
      .seriesSvgMulti()
      .series([annotationSeries])
      .mapping(data => data.annotations)
  )
  .decorate(sel =>
    sel
      .enter()
      .select("d3fc-svg.plot-area")
      .on("measure.range", () => {
        xScaleOriginal.range([0, d3.event.detail.width]);
        yScaleOriginal.range([d3.event.detail.height, 0]);
      })
      .call(zoom)
      .call(pointer)
  );

// render the chart with the required data
// Enqueues a redraw to occur on the next animation frame
const redraw = () => {
  d3.select("#chart")
    .datum({ annotations, data })
    .call(chart);
};
