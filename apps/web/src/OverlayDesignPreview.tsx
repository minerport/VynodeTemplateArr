import {
  dynamicValueIconForField,
  dynamicValueIcons,
  overlayShapeById,
  streamingServiceIcons,
  type OverlayLayer,
  type OverlayTemplateSummary,
} from '@vynode/contracts';
import {
  posterPreviewSample,
  templatePreviewMediaType,
  type PosterPreviewMediaType,
} from './posterPreviewSamples';

export const overlayPreviewContext: Record<string, string> = {
  resolution: '4K',
  imdbRating: '8.4',
  rtAudienceScore: '92',
  daysUntilRelease: '12',
  daysUntilAction: '5',
  title: 'Sample title',
  year: '2026',
  dateAdded: 'JUL 27',
  lastPlayed: 'JUL 25',
  releaseDate: 'JUL 27',
  nextEpisodeAirDate: 'AUG 03',
  nextSeasonAirDate: 'OCT 12',
  audioLanguages: 'EN · ES',
  audioChannels: '7.1',
  videoCodec: 'HEVC',
  hdr: 'HDR10',
  dolbyVision: 'DOLBY VISION',
  fileSize: '18.4 GB',
  episodeCount: '24 EPISODES',
  streamingProvider: 'Netflix',
};
export type OverlayPreviewContext = Readonly<Record<string, unknown>>;

const variableText = (
  layer: OverlayLayer,
  context: OverlayPreviewContext
) => {
  const segments = Array.isArray(layer.properties.segments)
    ? layer.properties.segments
    : [];
  const rendered = segments
    .map((segment) => {
      if (!segment || typeof segment !== 'object') return '';
      if (segment.type === 'text') return String(segment.value ?? '');
      const field = String(segment.field ?? '');
      return context[field] === null || context[field] === undefined
        ? field || 'Value'
        : String(context[field]);
    })
    .join('');
  return rendered || 'Dynamic value';
};

const assetIdFromPath = (value: unknown) => {
  const match = /^asset:\/\/(.+)$/.exec(String(value ?? '').trim());
  return match?.[1] ?? '';
};

const layerAssetId = (layer: OverlayLayer) =>
  String(layer.properties.assetId ?? '').trim() ||
  assetIdFromPath(
    layer.type === 'svg'
      ? layer.properties.iconPath
      : layer.properties.imagePath
  );

const assetUrl = (assetId: string) =>
  `/api/posters/collections/assets/${encodeURIComponent(assetId)}`;

const PreviewIcon = ({
  icon,
  properties,
}: {
  icon: (typeof dynamicValueIcons)[number];
  properties: OverlayLayer['properties'];
}) => {
  const mode = String(properties.iconStyle ?? 'outline');
  const main = String(properties.iconColor ?? '#ffffff');
  const soft = String(properties.iconSoftColor ?? main);
  const accent = String(properties.iconAccentColor ?? '#f3ad32');
  const common = {
    ['--icon-main' as any]: main,
    ['--icon-soft' as any]: soft,
    ['--icon-accent' as any]: accent,
    ['--icon-stroke' as any]: Number(properties.iconStrokeWidth ?? 1.8),
    ['--icon-dash' as any]:
      properties.iconStrokeStyle === 'dashed'
        ? '4 2.5'
        : properties.iconStrokeStyle === 'dotted'
          ? '1 2'
          : 'none',
    ['--icon-soft-opacity' as any]:
      Number(properties.iconSoftOpacity ?? (mode === 'solid' ? 24 : 100)) /
      100,
    ['--icon-accent-opacity' as any]:
      Number(properties.iconAccentOpacity ?? 100) / 100,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        transform: `scale(${properties.flipX ? -1 : 1}, ${properties.flipY ? -1 : 1})`,
      }}
    >
      {mode === 'badge' && (
        <rect
          x=".75" y=".75" width="22.5" height="22.5"
          rx={Number(properties.iconBadgeRadius ?? 12)}
          fill={String(properties.iconBadgeColor ?? main)}
          fillOpacity={Number(properties.iconBadgeOpacity ?? 18) / 100}
          stroke={String(properties.iconBadgeBorderColor ?? main)}
          strokeWidth={Number(properties.iconBadgeBorderWidth ?? 0)}
        />
      )}
      {icon.svgBody ? (
        <g
          className={`layered-icon layered-icon-${mode}`}
          style={common}
          transform={mode === 'badge' ? 'translate(2.5 2.5) scale(.7916667)' : undefined}
          dangerouslySetInnerHTML={{ __html: icon.svgBody }}
        />
      ) : (
        <path
          d={icon.path}
          fill={properties.iconFill ? main : 'none'}
          stroke={main}
          strokeWidth={Number(properties.iconStrokeWidth ?? 2)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
};

const mappedPathArtwork = (
  iconPath: string,
  color: string,
  fillOpacity: number,
  outlineColor: string,
  outlineWidth: number,
  properties: OverlayLayer['properties'] = {}
) => {
  const icon = iconPath.startsWith('icon://')
    ? dynamicValueIcons.find(
        (item) => item.id === iconPath.slice('icon://'.length)
      )
    : undefined;
  const shape = iconPath.startsWith('shape://')
    ? overlayShapeById(iconPath.slice('shape://'.length))
    : undefined;
  if (icon)
    return (
      <PreviewIcon
        icon={icon}
        properties={{ ...properties,
          iconColor: color,
          iconSoftColor: color,
          iconAccentColor: outlineColor,
          iconFillOpacity: fillOpacity * 100,
          iconOutlineWidth: outlineWidth,
        }}
      />
    );
  if (shape)
    return (
      <svg viewBox="0 0 120 72" aria-hidden="true">
        <path d={shape.path} fill={color} fillOpacity={fillOpacity}
          stroke={outlineWidth > 0 ? outlineColor : 'none'}
          strokeWidth={outlineWidth} />
      </svg>
    );
  const assetId = assetIdFromPath(iconPath);
  return assetId ? <img src={assetUrl(assetId)} alt="" loading="lazy" /> : null;
};

const layerRadii = (layer: OverlayLayer, canvasWidth = 1000) => {
  const topLeft =
    Number(
      layer.properties.borderRadiusTopLeft ?? layer.properties.borderRadius ?? 0
    ) / canvasWidth * 100;
  if (layer.properties.lockCorners === true) return `${topLeft}cqi`;
  return [
    topLeft,
    Number(layer.properties.borderRadiusTopRight ?? 0) / canvasWidth * 100,
    Number(layer.properties.borderRadiusBottomRight ?? 0) / canvasWidth * 100,
    Number(layer.properties.borderRadiusBottomLeft ?? 0) / canvasWidth * 100,
  ]
    .map((value) => `${value}cqi`)
    .join(' ');
};

export const OverlayDesignPreview = ({
  template,
  layersOnly = false,
  mediaType,
  sampleIndex = 0,
  context = overlayPreviewContext,
  sampleOverride,
}: {
  template: OverlayTemplateSummary;
  layersOnly?: boolean;
  mediaType?: PosterPreviewMediaType;
  sampleIndex?: number;
  context?: OverlayPreviewContext;
  sampleOverride?: { title: string; imageUrl: string };
}) => {
  const sample =
    sampleOverride ??
    posterPreviewSample(
      mediaType ?? templatePreviewMediaType(template),
      sampleIndex
    );
  const canvasUnit = (value: number) =>
    `${(value / Math.max(1, template.design.width)) * 100}cqi`;
  return (
    <div
      className={`overlay-design-preview ${layersOnly ? 'layers-only' : ''}`}
      aria-label={`${template.name} saved template preview`}
      style={{ '--overlay-accent': template.accent } as React.CSSProperties}
    >
      {!layersOnly && (
        <img
          className="poster-preview-backdrop"
          src={sample.imageUrl}
          alt={`${sample.title} example poster`}
          loading="lazy"
        />
      )}
      {[...template.design.elements]
        .filter((layer) => layer.properties.hidden !== true)
        .sort((left, right) => left.layerOrder - right.layerOrder)
        .map((layer) => {
          const style: React.CSSProperties = {
            left: `${(layer.x / template.design.width) * 100}%`,
            top: `${(layer.y / template.design.height) * 100}%`,
            width: `${(layer.width / template.design.width) * 100}%`,
            height: `${(layer.height / template.design.height) * 100}%`,
            transform: `rotate(${layer.rotation}deg)`,
            zIndex: layer.layerOrder + 1,
          };
          const assetId = layerAssetId(layer);
          const serviceSegments = Array.isArray(layer.properties.segments)
            ? layer.properties.segments
            : [];
          const serviceName =
            layer.type === 'variable' &&
            serviceSegments.length === 1 &&
            serviceSegments[0]?.type === 'variable' &&
            serviceSegments[0]?.field === 'streamingProvider'
              ? context.streamingProvider
              : undefined;
          const serviceIcon = typeof serviceName === 'string'
            ? streamingServiceIcons.find(
                (icon) => icon.label.toLowerCase() === serviceName.toLowerCase()
              )
            : undefined;
          if (serviceIcon) {
            return (
              <span key={layer.id} data-layer-id={layer.id} data-layer-type="service-logo"
                style={{ ...style, display: 'block', opacity: Number(layer.properties.opacity ?? 100) / 100 }}>
                <PreviewIcon icon={serviceIcon} properties={layer.properties} />
              </span>
            );
          }
          if ((layer.type === 'raster' || layer.type === 'svg') && assetId) {
            if (layer.type === 'svg' && layer.properties.svgFillEnabled === true) {
              const strokeWidth = Number(layer.properties.svgStrokeWidth ?? 0);
              const strokeColor = String(layer.properties.svgStrokeColor ?? '#000000');
              return <span key={layer.id} data-layer-id={layer.id} data-layer-type={layer.type} style={{
                ...style,
                opacity: Number(layer.properties.opacity ?? 100) / 100,
                backgroundColor: String(layer.properties.svgFillColor ?? '#ffffff'),
                WebkitMaskImage: `url("${assetUrl(assetId)}")`, maskImage: `url("${assetUrl(assetId)}")`,
                WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskPosition: 'center',
                WebkitMaskSize: 'contain', maskSize: 'contain',
                filter: strokeWidth > 0 ? `drop-shadow(${strokeWidth / 4}px 0 ${strokeColor}) drop-shadow(${-strokeWidth / 4}px 0 ${strokeColor}) drop-shadow(0 ${strokeWidth / 4}px ${strokeColor}) drop-shadow(0 ${-strokeWidth / 4}px ${strokeColor})` : undefined,
              }} />;
            }
            return (
              <img
                key={layer.id}
                data-layer-id={layer.id}
                data-layer-type={layer.type}
                src={assetUrl(assetId)}
                alt=""
                loading="lazy"
                style={{
                  ...style,
                  opacity: Number(layer.properties.opacity ?? 100) / 100,
                  objectFit: String(
                    layer.properties.fit ?? 'contain'
                  ) as React.CSSProperties['objectFit'],
                  filter:
                    layer.type === 'svg' && layer.properties.grayscale
                      ? 'grayscale(1)'
                      : undefined,
                }}
              />
            );
          }
          if (layer.type === 'tile') {
            return (
              <i
                key={layer.id}
                data-layer-id={layer.id}
                data-layer-type={layer.type}
                className="saved-preview-tile"
                style={{
                  ...style,
                  background: `color-mix(in srgb, ${String(
                    layer.properties.fillColor ?? '#000000'
                  )} ${Number(layer.properties.fillOpacity ?? 70)}%, transparent)`,
                  borderColor: String(
                    layer.properties.borderColor ?? 'transparent'
                  ),
                  borderWidth: canvasUnit(
                    Number(layer.properties.borderWidth ?? 0)
                  ),
                  borderRadius: layerRadii(layer, template.design.width),
                }}
              />
            );
          }
          if (layer.type === 'shape') {
            const shape = overlayShapeById(
              String(layer.properties.shapeId ?? 'soft-plate')
            );
            return (
              <svg
                key={layer.id}
                data-layer-id={layer.id}
                data-layer-type={layer.type}
                viewBox="0 0 120 72"
                preserveAspectRatio={
                  layer.properties.preserveAspectRatio
                    ? 'xMidYMid meet'
                    : 'none'
                }
                style={{
                  ...style,
                  opacity: Number(layer.properties.opacity ?? 100) / 100,
                }}
                aria-hidden="true"
              >
                <path
                  d={shape.path}
                  transform={`${layer.properties.flipX ? 'translate(120 0) scale(-1 1)' : ''} ${layer.properties.flipY ? 'translate(0 72) scale(1 -1)' : ''}`}
                  fill={String(layer.properties.fillColor ?? '#000000')}
                  fillOpacity={
                    Number(layer.properties.fillOpacity ?? 100) / 100
                  }
                  stroke={String(
                    layer.properties.borderColor ?? '#ffffff'
                  )}
                  strokeOpacity={
                    Number(layer.properties.borderOpacity ?? 100) / 100
                  }
                  strokeWidth={Number(layer.properties.borderWidth ?? 0)}
                  strokeDasharray={
                    layer.properties.outlineStyle === 'dashed'
                      ? '8 5'
                      : layer.properties.outlineStyle === 'dotted'
                        ? '2 5'
                        : undefined
                  }
                  strokeLinejoin="round"
                />
              </svg>
            );
          }
          if (layer.type === 'icon') {
            const icon =
              dynamicValueIcons.find(
                (item) =>
                  item.id === String(layer.properties.systemIcon ?? 'play')
              ) ?? dynamicValueIcons[0]!;
            return (
              <span
                key={layer.id}
                data-layer-id={layer.id}
                data-layer-type={layer.type}
                style={{
                  ...style,
                  display: 'block',
                  opacity: Number(layer.properties.iconOpacity ?? 100) / 100,
                  backgroundColor: `color-mix(in srgb, ${String(
                    layer.properties.iconBackgroundColor ?? '#000000'
                  )} ${Number(layer.properties.iconBackgroundOpacity ?? 0)}%, transparent)`,
                  borderColor: String(
                    layer.properties.iconBackgroundBorderColor ?? '#ffffff'
                  ),
                  borderStyle: 'solid',
                  borderWidth: canvasUnit(
                    Number(layer.properties.iconBackgroundBorderWidth ?? 0)
                  ),
                  borderRadius:
                    layer.properties.iconBackgroundShape === 'circle'
                      ? '50%'
                      : layer.properties.iconBackgroundShape === 'pill'
                        ? '999px'
                      : layer.properties.iconBackgroundShape === 'square'
                        ? '0'
                        : canvasUnit(
                            Number(layer.properties.iconBackgroundRadius ?? 12)
                          ),
                  padding: canvasUnit(
                    Number(layer.properties.iconBackgroundPadding ?? 0)
                  ),
                }}
              >
                <PreviewIcon icon={icon} properties={layer.properties} />
              </span>
            );
          }
          if (layer.type === 'mapped-icon') {
            const field = String(layer.properties.field ?? 'audioLanguages');
            const systemIcon = String(layer.properties.systemIcon ?? '');
            if (!systemIcon) {
              const mappings = Array.isArray(layer.properties.mappings)
                ? layer.properties.mappings
                : [];
              const contextValues = Array.isArray(context[field])
                ? (context[field] as unknown[])
                : [context[field]];
              const customIconPath = mappings
                .filter((mapping) =>
                  contextValues.some(
                    (value) =>
                      String(mapping?.value ?? '').toLowerCase() ===
                      String(value ?? '').toLowerCase()
                  )
                )
                .map((mapping) => String(mapping?.iconPath ?? ''))
                .find(Boolean);
              const artwork = customIconPath
                ? mappedPathArtwork(
                    customIconPath,
                    String(layer.properties.iconColor ?? '#f3ad32'),
                    Number(layer.properties.iconFillOpacity ?? 100) / 100,
                    String(
                      layer.properties.iconOutlineColor ??
                        layer.properties.iconColor ??
                        '#ffffff'
                    ),
                    Number(layer.properties.iconOutlineWidth ?? 0),
                    layer.properties
                  )
                : null;
              return (
                <span
                  className="saved-preview-mapped"
                  key={layer.id}
                  data-layer-id={layer.id}
                  data-layer-type={layer.type}
                  style={style}
                >
                  {artwork ? (
                    artwork
                  ) : (
                    '● ● ●'
                  )}
                </span>
              );
            }
            const icon =
              dynamicValueIcons.find((item) => item.id === systemIcon) ??
              dynamicValueIconForField(field);
            const mappedShape = systemIcon.startsWith('shape:')
              ? overlayShapeById(systemIcon.slice('shape:'.length))
              : undefined;
            const iconSize = canvasUnit(
              Number(layer.properties.iconSize ?? 80)
            );
            const backgroundShape = String(
              layer.properties.iconBackgroundShape ?? 'rounded'
            );
            const backgroundPadding = Math.max(
              0,
              (Number(layer.properties.iconBackgroundPadding ?? 12) /
                template.design.width) *
                100
            );
            return (
              <span
                className="saved-preview-dynamic"
                key={layer.id}
                data-layer-id={layer.id}
                data-layer-type={layer.type}
                style={{
                  ...style,
                  alignItems:
                    layer.properties.valueAlign === 'left'
                      ? 'flex-start'
                      : layer.properties.valueAlign === 'right'
                        ? 'flex-end'
                        : 'center',
                  gap: canvasUnit(Number(layer.properties.valueGap ?? 12)),
                  backgroundColor: `color-mix(in srgb, ${String(
                    layer.properties.groupBackgroundColor ?? '#000000'
                  )} ${Number(layer.properties.groupBackgroundOpacity ?? 0)}%, transparent)`,
                  borderColor: String(
                    layer.properties.groupBackgroundBorderColor ?? '#ffffff'
                  ),
                  borderStyle: 'solid',
                  borderWidth: canvasUnit(
                    Number(
                      layer.properties.groupBackgroundBorderWidth ?? 0
                    )
                  ),
                  borderRadius:
                    layer.properties.groupBackgroundShape === 'pill'
                      ? '999px'
                      : layer.properties.groupBackgroundShape === 'square'
                        ? '0'
                        : `${Math.max(
                            4,
                            (Number(
                              layer.properties.groupBackgroundPadding ?? 12
                            ) /
                              template.design.width) *
                              100
                          )}cqi`,
                  padding: canvasUnit(
                    Number(layer.properties.groupBackgroundPadding ?? 12)
                  ),
                }}
              >
                <span
                  className="saved-preview-icon-plate"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${String(
                      layer.properties.iconBackgroundColor ?? '#000000'
                    )} ${Number(
                      layer.properties.iconBackgroundOpacity ?? 0
                    )}%, transparent)`,
                    borderColor: String(
                      layer.properties.iconBackgroundBorderColor ?? '#ffffff'
                    ),
                    borderStyle: 'solid',
                    borderWidth: canvasUnit(
                      Math.max(
                        0,
                        Number(
                          layer.properties.iconBackgroundBorderWidth ?? 0
                        )
                      )
                    ),
                    borderRadius:
                      backgroundShape === 'circle'
                        ? '50%'
                        : backgroundShape === 'rounded'
                          ? `${Math.max(
                              (4 / template.design.width) * 100,
                              backgroundPadding
                            )}cqi`
                          : '0',
                    padding: `${backgroundPadding}cqi`,
                  }}
                >
                  {mappedShape ? <svg
                    aria-hidden="true" viewBox="0 0 120 72"
                    style={{
                      width: iconSize,
                      height: iconSize,
                      color: String(
                        layer.properties.iconColor ?? '#ffffff'
                      ),
                    }}
                    fill="none"
                    stroke={String(layer.properties.iconColor ?? '#ffffff')}
                    opacity={Number(layer.properties.iconOpacity ?? 100) / 100}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={mappedShape.path} fill="currentColor"
                      fillOpacity={Number(layer.properties.iconFillOpacity ?? 100) / 100}
                      stroke={String(layer.properties.iconOutlineColor ?? layer.properties.iconColor ?? '#ffffff')}
                      strokeWidth={Number(layer.properties.iconOutlineWidth ?? 0)}
                    />
                  </svg> : (
                    <span style={{ width: iconSize, height: iconSize, display: 'block',
                      opacity: Number(layer.properties.iconOpacity ?? 100) / 100 }}>
                      <PreviewIcon icon={icon} properties={layer.properties} />
                    </span>
                  )}
                </span>
                {layer.properties.showValue !== false && (
                  <b
                    style={{
                      color: String(layer.properties.valueColor ?? '#ffffff'),
                      opacity:
                        Number(layer.properties.valueOpacity ?? 100) / 100,
                      fontFamily: String(
                        layer.properties.valueFontFamily ?? 'Inter'
                      ),
                      fontSize: canvasUnit(
                        Math.max(
                          7,
                          Number(layer.properties.valueFontSize ?? 42)
                        )
                      ),
                      fontWeight: String(
                        layer.properties.valueFontWeight ?? 'bold'
                      ) as React.CSSProperties['fontWeight'],
                      fontStyle: String(
                        layer.properties.valueFontStyle ?? 'normal'
                      ) as React.CSSProperties['fontStyle'],
                      backgroundColor: `color-mix(in srgb, ${String(
                        layer.properties.valueBackgroundColor ?? '#000000'
                      )} ${Number(layer.properties.valueBackgroundOpacity ?? 0)}%, transparent)`,
                      borderColor: String(
                        layer.properties.valueBackgroundBorderColor ?? '#ffffff'
                      ),
                      borderStyle: 'solid',
                      borderWidth: canvasUnit(
                        Number(
                          layer.properties.valueBackgroundBorderWidth ?? 0
                        )
                      ),
                      borderRadius:
                        layer.properties.valueBackgroundShape === 'pill'
                          ? '999px'
                          : layer.properties.valueBackgroundShape === 'square'
                            ? '0'
                            : `${Math.max(
                                4,
                                (Number(
                                  layer.properties.valueBackgroundPadding ?? 8
                                ) /
                                  template.design.width) *
                                  100
                              )}cqi`,
                      padding: canvasUnit(
                        Number(
                          layer.properties.valueBackgroundPadding ?? 8
                        )
                      ),
                    }}
                  >
                    {context[field] === null ||
                    context[field] === undefined
                      ? field.replace(/([A-Z])/g, ' $1').toUpperCase()
                      : Array.isArray(context[field])
                        ? (context[field] as unknown[]).map(String).join(' · ')
                        : String(context[field])}
                  </b>
                )}
              </span>
            );
          }
          return (
            <strong
              key={layer.id}
              data-layer-id={layer.id}
              data-layer-type={layer.type}
              className={`saved-preview-text ${layer.type}`}
              style={{
                ...style,
                color: `color-mix(in srgb, ${String(
                  layer.properties.color ?? '#ffffff'
                )} ${Number(layer.properties.opacity ?? 100)}%, transparent)`,
                fontFamily: String(layer.properties.fontFamily ?? 'Inter'),
                fontWeight: String(
                  layer.properties.fontWeight ?? 'bold'
                ) as React.CSSProperties['fontWeight'],
                fontStyle: String(
                  layer.properties.fontStyle ?? 'normal'
                ) as React.CSSProperties['fontStyle'],
                textAlign: String(
                  layer.properties.textAlign ?? 'center'
                ) as React.CSSProperties['textAlign'],
                justifyContent:
                  layer.properties.textAlign === 'left'
                    ? 'flex-start'
                    : layer.properties.textAlign === 'right'
                      ? 'flex-end'
                      : 'center',
                fontSize: canvasUnit(
                  Math.max(7, Number(layer.properties.fontSize ?? 60))
                ),
                WebkitTextStrokeColor: String(
                  layer.properties.textStrokeColor ?? '#000000'
                ),
                WebkitTextStrokeWidth: canvasUnit(
                  Number(layer.properties.textStrokeWidth ?? 0)
                ),
                textShadow:
                  Number(layer.properties.textShadowOpacity ?? 0) > 0
                    ? `${canvasUnit(Number(layer.properties.textShadowOffsetX ?? 0))} ${canvasUnit(Number(layer.properties.textShadowOffsetY ?? 0))} ${canvasUnit(Number(layer.properties.textShadowBlur ?? 0))} color-mix(in srgb, ${String(layer.properties.textShadowColor ?? '#000000')} ${Number(layer.properties.textShadowOpacity ?? 0)}%, transparent)`
                    : undefined,
                backgroundColor: `color-mix(in srgb, ${String(
                  layer.properties.fillColor ?? '#000000'
                )} ${Number(layer.properties.fillOpacity ?? 0)}%, transparent)`,
                borderColor: String(
                  layer.properties.borderColor ?? 'transparent'
                ),
                borderStyle: 'solid',
                borderWidth: canvasUnit(
                  Number(layer.properties.borderWidth ?? 0)
                ),
                borderRadius: layerRadii(layer, template.design.width),
              }}
            >
              {layer.type === 'text'
                ? String(layer.properties.text ?? layer.name)
                : variableText(layer, context)}
            </strong>
          );
        })}
      {!template.design.elements.length && (
        <span className="saved-preview-empty">No layers</span>
      )}
    </div>
  );
};
