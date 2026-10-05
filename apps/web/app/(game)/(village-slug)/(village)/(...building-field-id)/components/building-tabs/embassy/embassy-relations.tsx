import { useTranslation } from 'react-i18next';
import { formatNumber } from '@pillage-first/utils/format';
import { Bookmark } from 'app/(game)/(village-slug)/(village)/(...building-field-id)/components/building-tabs/bookmark';
import {
  OverflowContainer,
  Section,
  SectionContent,
} from 'app/(game)/(village-slug)/components/building-layout';
import { useReputations } from 'app/(game)/(village-slug)/hooks/use-reputations';
import { InformationPopover } from 'app/(game)/components/information-popover';
import { Text } from 'app/components/text';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from 'app/components/ui/table';

export const EmbassyRelations = () => {
  const { t } = useTranslation();
  const { reputations } = useReputations();

  const factionReputations = reputations
    .filter(({ faction }) => faction !== 'player')
    .sort((a, b) => b.reputation - a.reputation);

  return (
    <Section>
      <SectionContent>
        <Bookmark tab="relations" />
        <InformationPopover ariaLabel={t('Relations')}>
          <Text>
            {t(
              'Relations show where you stand with each faction in this world.',
            )}
          </Text>
        </InformationPopover>
        <Text as="h2">{t('Relations')}</Text>
      </SectionContent>
      <SectionContent>
        <OverflowContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>{t('Faction')}</TableHeaderCell>
                <TableHeaderCell>{t('Reputation')}</TableHeaderCell>
                <TableHeaderCell>{t('Standing')}</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {factionReputations.map(
                ({ faction, reputation, reputationLevel }) => (
                  <TableRow key={faction}>
                    <TableCell>
                      {t(`FACTIONS.${faction.toUpperCase()}`)}
                    </TableCell>
                    <TableCell>
                      {t(`REPUTATIONS.${reputationLevel.toUpperCase()}`)}
                    </TableCell>
                    <TableCell>{formatNumber(reputation)}</TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        </OverflowContainer>
      </SectionContent>
    </Section>
  );
};
