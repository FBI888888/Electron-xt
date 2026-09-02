import { PageHeader } from '../../components/ui';

export const AboutPage = () => (
  <div className="page">
    <PageHeader title="软件使用免责声明" description="使用前请阅读并理解以下条款。" />
    <div className="page-content page-content--scroll">
      <section className="section-panel legal-copy">
        <p>本软件仅提供公开信息采集工具功能，仅支持采集星图平台已公开的达人主页信息，不具备获取非公开数据的能力。</p>
        <p>您承诺使用本软件时严格遵守《中华人民共和国网络安全法》《数据安全法》《个人信息保护法》等相关法律法规，以及星图、抖音等平台的用户协议与社区规范，不得用于任何违法违规用途。</p>
        <p><strong>禁止利用本软件实施以下行为：</strong>采集非公开信息、过度爬取导致平台服务器负载异常、侵害他人隐私权/知识产权/商业秘密等合法权益、用于 spam 营销、诈骗等违法活动。</p>
        <p>本软件仅为工具提供者，不对您使用软件的行为及结果承担责任。如因您违规使用软件导致的任何法律纠纷、行政处罚、第三方索赔等，均由您自行承担全部责任，与软件开发者无关。</p>
        <p>如发现软件存在异常或有违规使用需求，开发者有权暂停或终止您的使用权限，且不承担任何赔偿责任。</p>
        <p><strong>您使用本软件即表示已充分阅读、理解并同意本声明全部条款，若不同意请立即停止使用。</strong></p>
      </section>
    </div>
  </div>
);
