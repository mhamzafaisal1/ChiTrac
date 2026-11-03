import {
  Component,
  Input,
  ElementRef,
  ViewChild,
  AfterViewInit
} from "@angular/core";
import * as d3 from "d3";

interface ChartData {
  machine: {
    serial: string;
    name: string;
  };
  timeRange: {
    start: string;
    end: string;
  };
  hourlyData: {
    hour: string;
    oee: number;
    operators: {
      name: string;
      efficiency: number;
    }[];
  }[];
}

interface TransformedData {
  date: Date;
  oee: number;
  operators: {
    name: string;
    efficiency: number;
  }[];
}

interface DataPoint {
  date: Date;
  value: number;
}

@Component({
  selector: "app-multiple-line-chart",
  standalone: true,
  templateUrl: "./multiple-line-chart.component.html",
  styleUrl: "./multiple-line-chart.component.scss"
})
export class MultipleLineChartComponent implements AfterViewInit {
  @ViewChild("chartContainer") private chartContainer!: ElementRef;
  @Input() data!: ChartData;
  @Input() isDarkTheme: boolean = false;

  private chartWidth = 800;
  private chartHeight = 490;
  private margin = { top: 40, right: 150, bottom: 60, left: 60 };

  ngAfterViewInit() {
    if (this.data) {
      this.createChart();
    }
  }

  private transformData(data: ChartData): TransformedData[] {
    return data.hourlyData.map(hour => ({
      date: new Date(hour.hour),
      oee: hour.oee,
      operators: hour.operators
    }));
  }

  private getColorScale(keys: string[]) {
    const palette = ['#66bb6a', '#42a5f5', '#ffca28', '#ab47bc', '#ef5350', '#29b6f6', '#ffa726', '#7e57c2', '#26c6da', '#ec407a'];
    return d3.scaleOrdinal<string>().domain(keys).range(palette);
  }

  private createChart() {
    d3.select(this.chartContainer.nativeElement).selectAll("*").remove();
    const textColor = this.isDarkTheme ? "#e0e0e0" : "#333";

    const transformedData = this.transformData(this.data);
    const keys = ["OEE", ...new Set(transformedData.flatMap(d => d.operators.map(op => op.name)))];
    const color = this.getColorScale(keys);

    const svg = d3.select(this.chartContainer.nativeElement)
      .append("svg")
      .attr("viewBox", `0 0 ${this.chartWidth} ${this.chartHeight}`)
      .style("width", "100%")
      .style("height", "auto")
      .style("display", "block")
      //.style("font-family", "'Inter', sans-serif")
      .style("font-size", "0.875rem");

    const rawMax = d3.max(transformedData, d =>
      Math.max(d.oee, ...d.operators.map(op => op.efficiency))
    ) ?? 100;
    const yMax = Math.ceil(rawMax * 1.05);

    const x = d3.scaleTime()
      .domain(d3.extent(transformedData, d => d.date) as [Date, Date])
      .range([this.margin.left, this.chartWidth - this.margin.right]);

    const y = d3.scaleLinear()
      .domain([0, yMax])
      .range([this.chartHeight - this.margin.bottom, this.margin.top])
      .nice();

    svg.append("g")
      .attr("transform", `translate(0,${this.chartHeight - this.margin.bottom})`)
      .call(d3.axisBottom(x).ticks(this.chartWidth / 80).tickSizeOuter(0))
      .selectAll("text")
      .attr("transform", "rotate(-45)")
      .style("text-anchor", "end")
      .style("fill", textColor);

    svg.append("g")
      .attr("transform", `translate(${this.margin.left},0)`)
      .call(d3.axisLeft(y))
      .selectAll("text")
      .style("fill", textColor);

    svg.selectAll(".tick line")
      .style("stroke", textColor)
      .style("stroke-opacity", 0.2);

    // Y-axis label
    svg.append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", 15)
      .attr("x", -(this.chartHeight / 2))
      .attr("dy", "-2.5em")
      .style("text-anchor", "middle")
      .style("fill", textColor)
      .style("font-size", "12px")
      .text("Efficiency (%)");

    const line = d3.line<DataPoint>()
      .x(d => x(d.date))
      .y(d => y(d.value));

    const drawLineWithPeak = (label: string, points: DataPoint[]) => {
      svg.append("path")
        .datum(points)
        .attr("fill", "none")
        .attr("stroke", color(label))
        .attr("stroke-width", 1.8)
        .attr("d", line);

      const peak = points.reduce((max, p) => p.value > max.value ? p : max, points[0]);

      svg.append("circle")
        .attr("cx", x(peak.date))
        .attr("cy", y(peak.value))
        .attr("r", 3)
        .attr("fill", color(label));
    };

    drawLineWithPeak("OEE", transformedData.map(d => ({ date: d.date, value: d.oee })));

    const operatorNames = new Set(transformedData.flatMap(d => d.operators.map(op => op.name)));
    operatorNames.forEach(name => {
      const points = transformedData.map(d => ({
        date: d.date,
        value: d.operators.find(op => op.name === name)?.efficiency ?? 0
      }));
      drawLineWithPeak(name, points);
    });

    // Chart title
    svg.append("text")
      .attr("x", this.chartWidth / 2)
      .attr("y", this.margin.top / 2)
      .attr("text-anchor", "middle")
      .style("font-size", "16px")
      .style("fill", textColor)
      .text(`Efficiency Over Time: ${this.data.machine.name}`);

    // Legend
    const legend = svg.append("g")
      .attr("font-size", 10)
      .attr("text-anchor", "start")
      .attr("transform", `translate(${this.chartWidth - this.margin.right + 10}, ${this.margin.top})`);

    legend.selectAll("g")
      .data(keys)
      .join("g")
      .attr("transform", (_d, i) => `translate(0, ${i * 20})`)
      .each(function (d) {
        const g = d3.select(this);
        g.append("rect")
          .attr("width", 14)
          .attr("height", 14)
          .attr("fill", color(d));
        g.append("text")
          .attr("x", 20)
          .attr("y", 11)
          .style("fill", textColor)
          .text(d);
      });
  }
}
