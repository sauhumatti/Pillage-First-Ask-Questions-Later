import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ITooltip as ReactTooltipProps } from 'react-tooltip';
import type { BuildingField as BuildingFieldType } from '@pillage-first/types/models/building-field';
import type { Route } from '@react-router/types/app/(game)/(village-slug)/(village)/+types/page';
import { BuildingField } from 'app/(game)/(village-slug)/(village)/components/building-field';
import {
  ResourceFieldsScene,
  VillageScene,
} from 'app/(game)/(village-slug)/(village)/components/village-scene';
import { VillageMapContext } from 'app/(game)/(village-slug)/(village)/providers/village-map-context';
import { BuildingFieldTooltip } from 'app/(game)/(village-slug)/components/building-field-tooltip';
import { useCurrentVillage } from 'app/(game)/(village-slug)/hooks/current-village/use-current-village';
import { useMediaQuery } from 'app/(game)/(village-slug)/hooks/dom/use-media-query';
import { useBookmarks } from 'app/(game)/(village-slug)/hooks/use-bookmarks';
import { usePreferences } from 'app/(game)/(village-slug)/hooks/use-preferences';
import layoutStyles from 'app/(game)/(village-slug)/layout.module.scss';
import { PageContents } from 'app/components/page-contents';
import { Tooltip } from 'app/components/tooltip';

const resourceViewBuildingFieldIds = Array.from(
  { length: 18 },
  (_, i) => i + 1,
);
const villageViewBuildingFieldIds = Array.from(
  { length: 22 },
  (_, i) => i + 19,
);

const VillagePage = (props: Route.ComponentProps) => {
  const { params, matches } = props;

  const { serverSlug, villageSlug } = params;

  const { t } = useTranslation();
  const isWiderThanLg = useMediaQuery('(min-width: 1024px)');
  const { currentVillage } = useCurrentVillage();
  const { bookmarks } = useBookmarks();
  const { preferences } = usePreferences();
  const buildingFieldById = useMemo(
    () =>
      new Map<BuildingFieldType['id'], BuildingFieldType>(
        currentVillage.buildingFields.map((buildingField) => [
          buildingField.id,
          buildingField,
        ]),
      ),
    [currentVillage.buildingFields],
  );

  const isResourcesPageOpen = matches.some(
    (match) => match?.id === 'resources-page',
  );
  const isVillagePageOpen = matches.some(
    (match) => match?.id === 'village-page',
  );

  const renderTooltip = useCallback(
    ({
      activeAnchor,
    }: Parameters<NonNullable<ReactTooltipProps['render']>>[0]) => {
      const id = activeAnchor?.getAttribute('data-building-field-id');
      if (!id) {
        return null;
      }

      const buildingFieldId = Number(id);
      const buildingField = buildingFieldById.get(buildingFieldId);

      if (!buildingField) {
        return t('Building site');
      }

      return <BuildingFieldTooltip buildingField={buildingField} />;
    },
    [buildingFieldById, t],
  );

  useEffect(() => {
    const className = layoutStyles['background-image--village'];
    document.body.classList.toggle(
      className,
      isVillagePageOpen || isResourcesPageOpen,
    );

    return () => {
      document.body.classList.remove(className);
    };
  }, [isVillagePageOpen, isResourcesPageOpen]);

  const title = `${isResourcesPageOpen ? t('Resources') : t('Village')} | Pillage First! - ${serverSlug} - ${villageSlug}`;
  const buildingFieldIds = isResourcesPageOpen
    ? resourceViewBuildingFieldIds
    : villageViewBuildingFieldIds;

  const villageMapContextValue = useMemo(
    () => ({
      bookmarks,
      currentVillage,
      isWiderThanLg,
      shouldShowBuildingNames: preferences.shouldShowBuildingNames,
    }),
    [
      bookmarks,
      currentVillage,
      isWiderThanLg,
      preferences.shouldShowBuildingNames,
    ],
  );

  return (
    <PageContents>
      <title>{title}</title>
      <Tooltip
        anchorSelect="[data-building-field-id]"
        className="text-xs!"
        closeEvents={{
          mouseleave: true,
        }}
        hidden={!isWiderThanLg}
        render={renderTooltip}
      />
      <main className="flex flex-col items-center justify-center mx-auto px-safe lg:px-0 lg:mt-20 lg:mb-0 min-h-80 h-[calc(100dvh-17.5rem)] lg:min-h-0 lg:h-auto overflow-x-hidden">
        <VillageMapContext value={villageMapContextValue}>
          <div className="relative aspect-16/10 scrollbar-hidden min-w-[460px] max-w-5xl w-full">
            {isResourcesPageOpen && <ResourceFieldsScene />}
            {isVillagePageOpen && (
              <VillageScene wallField={buildingFieldById.get(40) ?? null} />
            )}
            {buildingFieldIds.map((buildingFieldId) => (
              <BuildingField
                buildingField={buildingFieldById.get(buildingFieldId) ?? null}
                buildingFieldId={buildingFieldId}
                key={buildingFieldId}
              />
            ))}
            {isResourcesPageOpen && (
              <Link
                to="../village"
                className="group absolute left-1/2 top-1/2 h-12 w-16 lg:h-[7.5rem] lg:w-[10.5rem] -translate-x-1/2 -translate-y-1/2 rounded-[50%] transition-shadow hover:shadow-[0_0_0_3px_rgba(255,236,170,0.8)] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-black/80"
                aria-label={t('Village')}
              >
                <span className="absolute left-1/2 top-full -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-xs bg-black/60 px-1 text-3xs text-white md:text-2xs">
                  {t('Village')}
                </span>
              </Link>
            )}
          </div>
        </VillageMapContext>
      </main>
    </PageContents>
  );
};

export default VillagePage;
