{{/*
Expand the name of the chart.
*/}}
{{- define "veryfront-renderer.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "veryfront-renderer.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "veryfront-renderer.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "veryfront-renderer.labels" -}}
helm.sh/chart: {{ include "veryfront-renderer.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Proxy selector labels
*/}}
{{- define "veryfront-renderer.proxy.selectorLabels" -}}
app.kubernetes.io/name: veryfront-proxy
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Renderer selector labels
*/}}
{{- define "veryfront-renderer.renderer.selectorLabels" -}}
app.kubernetes.io/name: veryfront-renderer
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the proxy component
*/}}
{{- define "veryfront-renderer.proxy.fullname" -}}
veryfront-proxy
{{- end }}

{{/*
Create the name of the renderer component
*/}}
{{- define "veryfront-renderer.renderer.fullname" -}}
veryfront-renderer
{{- end }}
