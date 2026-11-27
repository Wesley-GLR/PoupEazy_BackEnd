function reportFixture(count = 18) {
  return {
    data_inicio:'2026-11-05',data_fim:'2026-11-27',gerado_em:'2026-11-27T15:30:00Z',
    secoes:['resumo','transacoes','categorias','orcamentos','metas'],
    dados:{
      resumo:{receitas:'5200.00',despesas:'1850.45',saldo:'3349.55',transacoes:count},
      transacoes:Array.from({length:count},(_,index)=>({data:'2026-11-12',descricao:index===0?'Compra com descrição longa: alimentação, transporte e organização financeira familiar. '.repeat(3).slice(0,255):index===1?'PalavraSemEspacos'.repeat(15):`Lançamento de exemplo ${index+1}`,
        categoria:'Alimentação e cuidados pessoais',tipo:index%4===0?'receita':'despesa',valor:'123.45',origem:'manual'})),
      categorias:[{categoria:'Alimentação e cuidados pessoais',tipo:'despesa',total:'1850.45',quantidade:16},{categoria:'Salário',tipo:'receita',total:'5200.00',quantidade:2}],
      orcamentos:[{ano:2026,mes:11,valor_planejado:'3000.00',gasto_periodo:'1850.45',inicio_coberto:'2026-11-05',fim_coberto:'2026-11-27',mes_parcial:true}],
      metas:[{nome:'Reserva de emergência para a família',status:'ativa',valor_objetivo:'20000.00',valor_atual:'5700.00',data_limite:'2027-12-31',aportes_periodo:'400.00',retiradas_periodo:'50.00',movimento_periodo:'350.00'},
        {nome:'Viagem de férias 🌍 漢字',status:'concluida',valor_objetivo:'8000.00',valor_atual:'8000.00',data_limite:'2026-12-31',aportes_periodo:'1000.00',retiradas_periodo:'0.00',movimento_periodo:'1000.00'}],
    },
  };
}
module.exports = { reportFixture };
